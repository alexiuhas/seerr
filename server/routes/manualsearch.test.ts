import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import TheMovieDb from '@server/api/themoviedb';
import type { TmdbMovieDetails } from '@server/api/themoviedb/interfaces';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { setupTestDb } from '@server/test/db';
import type { Axios, AxiosRequestConfig } from 'axios';
import axios from 'axios';
import type { Express } from 'express';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from './auth';
import manualSearchRoutes from './manualsearch';

const PROWLARR_URL = 'http://prowlarr:9696';
const PROWLARR_API_KEY = 'prowlarr-key';

// TMDB is faked by overriding its client's method; each call records the
// language it was asked for.
let tmdbMovie: Partial<TmdbMovieDetails> = {};
const tmdbCalls: { movieId: number; language?: string }[] = [];

Object.defineProperty(TheMovieDb.prototype, 'getMovie', {
  get() {
    return async (args: { movieId: number; language?: string }) => {
      tmdbCalls.push(args);
      return { id: args.movieId, ...tmdbMovie } as TmdbMovieDetails;
    };
  },
  set() {},
  configurable: true,
});

// Prowlarr is faked at its HTTP client: every axios request lands here.
interface OutboundRequest {
  /** Fully serialized URL, query string included. */
  uri: string;
  method?: string;
  headers: Record<string, unknown>;
}
let outbound: OutboundRequest[] = [];
let prowlarrResponder: (req: OutboundRequest) => unknown = () => [];

function fakeHttp() {
  mock.method(
    axios.Axios.prototype,
    'request',
    async function (this: Axios, config: AxiosRequestConfig) {
      const req: OutboundRequest = {
        uri: this.getUri(config),
        method: config.method,
        headers: {
          ...(this.defaults.headers as unknown as Record<string, unknown>),
          ...(config.headers as Record<string, unknown>),
        },
      };
      outbound.push(req);
      return { status: 200, data: prowlarrResponder(req) };
    }
  );
}

function httpError(status: number, data: unknown = {}) {
  return Object.assign(new Error(`Request failed with status ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

function networkError() {
  return Object.assign(new Error('connect ECONNREFUSED'), {
    isAxiosError: true,
    code: 'ECONNREFUSED',
  });
}

let app: Express;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({ secret: 'test-secret', resave: false, saveUninitialized: false })
  );
  app.use(checkUser);
  app.use('/auth', authRoutes);
  app.use('/manualsearch', manualSearchRoutes);
  app.use(
    (
      err: { status?: number; message?: string },
      _req: express.Request,
      res: express.Response,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: express.NextFunction
    ) => {
      res
        .status(err.status ?? 500)
        .json({ status: err.status ?? 500, message: err.message });
    }
  );
  return app;
}

before(() => {
  app = createApp();
});

setupTestDb();

beforeEach(() => {
  process.env.PROWLARR_URL = PROWLARR_URL;
  process.env.PROWLARR_API_KEY = PROWLARR_API_KEY;
  tmdbMovie = {
    title: 'Anatomy of a Fall',
    original_title: "Anatomie d'une chute",
    release_date: '2023-08-23',
  };
  tmdbCalls.length = 0;
  outbound = [];
  prowlarrResponder = () => [];
  fakeHttp();
});

afterEach(() => {
  delete process.env.PROWLARR_URL;
  delete process.env.PROWLARR_API_KEY;
  mock.restoreAll();
});

async function loginAs(email: string) {
  const settings = getSettings();
  const priorLocalLogin = settings.main.localLogin;
  settings.main.localLogin = true;
  try {
    const agent = request.agent(app);
    const res = await agent
      .post('/auth/local')
      .send({ email, password: 'test1234' });
    assert.strictEqual(res.status, 200);
    return agent;
  } finally {
    settings.main.localLogin = priorLocalLogin;
  }
}

const asAdmin = () => loginAs('admin@seerr.dev');
const asUser = () => loginAs('demo@seerr.dev');

describe('Manual Search access', () => {
  it('refuses non-admins on options', async () => {
    const agent = await asUser();
    const res = await agent
      .get('/manualsearch/options')
      .query({ mediaType: 'movie', tmdbId: 1 });
    assert.strictEqual(res.status, 403);
  });

  it('refuses non-admins on search', async () => {
    const agent = await asUser();
    const res = await agent
      .get('/manualsearch')
      .query({ mediaType: 'movie', tmdbId: 1, query: 'x' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(outbound.length, 0);
  });
});

describe('GET /manualsearch/options', () => {
  it('reports disabled when Prowlarr env vars are unset', async () => {
    delete process.env.PROWLARR_URL;
    delete process.env.PROWLARR_API_KEY;
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch/options')
      .query({ mediaType: 'movie', tmdbId: 376867 });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.enabled, false);
  });

  it('reports disabled when only the URL is set', async () => {
    delete process.env.PROWLARR_API_KEY;
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch/options')
      .query({ mediaType: 'movie', tmdbId: 376867 });
    assert.strictEqual(res.body.enabled, false);
  });

  it('prefills the English title + year and offers the differing original title', async () => {
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch/options')
      .query({ mediaType: 'movie', tmdbId: 915935 });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      enabled: true,
      queries: {
        english: 'Anatomy of a Fall 2023',
        original: "Anatomie d'une chute 2023",
      },
    });
    assert.deepStrictEqual(tmdbCalls, [{ movieId: 915935, language: 'en' }]);
  });

  it('fetches the title in English even when the admin uses another locale', async () => {
    const settings = getSettings();
    const priorLocale = settings.main.locale;
    settings.main.locale = 'fr';
    try {
      const agent = await asAdmin();
      await agent
        .get('/manualsearch/options')
        .query({ mediaType: 'movie', tmdbId: 915935 });
      assert.deepStrictEqual(
        tmdbCalls.map((c) => c.language),
        ['en']
      );
    } finally {
      settings.main.locale = priorLocale;
    }
  });

  it('omits the original-title query when it matches the English title', async () => {
    tmdbMovie = {
      title: 'Fight Club',
      original_title: 'Fight Club',
      release_date: '1999-10-15',
    };
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch/options')
      .query({ mediaType: 'movie', tmdbId: 550 });
    assert.deepStrictEqual(res.body.queries, { english: 'Fight Club 1999' });
  });

  it('leaves the year off when TMDB has no release date', async () => {
    tmdbMovie = {
      title: 'Untitled Project',
      original_title: 'Untitled Project',
      release_date: '',
    };
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch/options')
      .query({ mediaType: 'movie', tmdbId: 1 });
    assert.deepStrictEqual(res.body.queries, { english: 'Untitled Project' });
  });
});

function prowlarrRelease(overrides: Record<string, unknown> = {}) {
  return {
    guid: 'https://1337x.to/torrent/1',
    indexerId: 3,
    indexer: '1337x',
    title: 'Anatomy.of.a.Fall.2023.1080p.BluRay.x264-PiGNUS',
    size: 11_703_786_291,
    seeders: 214,
    leechers: 12,
    publishDate: '2023-09-20T10:00:00Z',
    age: 412,
    protocol: 'torrent',
    categories: [
      { id: 2040, name: 'Movies/HD' },
      { id: 100042, name: 'Movies HD' },
    ],
    downloadUrl: 'http://prowlarr:9696/3/download?link=abc',
    infoUrl: 'https://1337x.to/torrent/1/info',
    ...overrides,
  };
}

describe('GET /manualsearch', () => {
  it('searches Prowlarr movie categories for the query', async () => {
    const agent = await asAdmin();
    const res = await agent.get('/manualsearch').query({
      mediaType: 'movie',
      tmdbId: 915935,
      query: 'Anatomy of a Fall 2023',
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(outbound.length, 1);
    const url = new URL(outbound[0].uri);
    assert.strictEqual(
      url.origin + url.pathname,
      `${PROWLARR_URL}/api/v1/search`
    );
    assert.strictEqual(url.searchParams.get('query'), 'Anatomy of a Fall 2023');
    assert.strictEqual(url.searchParams.get('type'), 'search');
    assert.deepStrictEqual(url.searchParams.getAll('categories'), ['2000']);
    assert.strictEqual(url.searchParams.get('limit'), '100');
    assert.strictEqual(outbound[0].headers['X-Api-Key'], PROWLARR_API_KEY);
  });

  it('returns torrent Releases only, in the Release shape', async () => {
    prowlarrResponder = () => [
      prowlarrRelease(),
      prowlarrRelease({
        guid: 'nzb-1',
        protocol: 'usenet',
        title: 'Usenet.Release',
      }),
    ];
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch')
      .query({ mediaType: 'movie', tmdbId: 915935, query: 'Anatomy' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      results: [
        {
          guid: 'https://1337x.to/torrent/1',
          indexerId: 3,
          indexer: '1337x',
          title: 'Anatomy.of.a.Fall.2023.1080p.BluRay.x264-PiGNUS',
          size: 11_703_786_291,
          seeders: 214,
          leechers: 12,
          publishDate: '2023-09-20T10:00:00Z',
          ageDays: 412,
          categories: ['Movies/HD'],
          downloadUrl: 'http://prowlarr:9696/3/download?link=abc',
          infoUrl: 'https://1337x.to/torrent/1/info',
        },
      ],
    });
  });

  it('reports all indexers unavailable when Prowlarr answers 400', async () => {
    prowlarrResponder = () => {
      throw httpError(400, {
        message: 'Search failed due to all selected indexers being unavailable',
      });
    };
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch')
      .query({ mediaType: 'movie', tmdbId: 915935, query: 'Anatomy' });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.code, 'INDEXERS_UNAVAILABLE');
  });

  it('reports Prowlarr unreachable when the connection fails', async () => {
    prowlarrResponder = () => {
      throw networkError();
    };
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch')
      .query({ mediaType: 'movie', tmdbId: 915935, query: 'Anatomy' });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.code, 'PROWLARR_UNREACHABLE');
  });

  it('reports Prowlarr unreachable when it answers with a server error', async () => {
    prowlarrResponder = () => {
      throw httpError(500);
    };
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch')
      .query({ mediaType: 'movie', tmdbId: 915935, query: 'Anatomy' });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.code, 'PROWLARR_UNREACHABLE');
  });

  it('refuses to search when Prowlarr is not configured', async () => {
    delete process.env.PROWLARR_URL;
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch')
      .query({ mediaType: 'movie', tmdbId: 915935, query: 'Anatomy' });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.code, 'DISABLED');
    assert.strictEqual(outbound.length, 0);
  });

  it('returns no results as an empty list, not an error', async () => {
    prowlarrResponder = () => [];
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch')
      .query({ mediaType: 'movie', tmdbId: 915935, query: 'Nothing matches' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { results: [] });
  });
});
