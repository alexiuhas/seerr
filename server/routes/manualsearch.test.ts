import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, it, mock } from 'node:test';

import TheMovieDb from '@server/api/themoviedb';
import type {
  TmdbMovieDetails,
  TmdbTvDetails,
} from '@server/api/themoviedb/interfaces';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import { checkUser } from '@server/middleware/auth';
import { contractViolations } from '@server/test/arrContracts';
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

let tmdbTv: Partial<TmdbTvDetails> = {};
const tmdbTvCalls: { tvId: number; language?: string }[] = [];

Object.defineProperty(TheMovieDb.prototype, 'getTvShow', {
  get() {
    return async (args: { tvId: number; language?: string }) => {
      tmdbTvCalls.push(args);
      return { id: args.tvId, ...tmdbTv } as TmdbTvDetails;
    };
  },
  set() {},
  configurable: true,
});

const tmdbSeason = (season_number: number) => ({
  id: 1000 + season_number,
  air_date: '2022-02-18',
  episode_count: 9,
  name: season_number ? `Season ${season_number}` : 'Specials',
  overview: '',
  season_number,
});

// Prowlarr, Radarr and Sonarr are faked at their HTTP client: every axios request
// lands here.
interface OutboundRequest {
  /** Fully serialized URL, query string included. */
  uri: string;
  method?: string;
  headers: Record<string, unknown>;
  body?: unknown;
}
let outbound: OutboundRequest[] = [];
let httpResponder: (req: OutboundRequest) => unknown = () => [];

// Every faked request and response is checked against the apps' published
// API contracts; any mismatch fails the test that made it.
let contractBreaks: string[] = [];
/** Set by a test whose fake response deliberately predates the contract. */
let offContractResponse = false;

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
        body:
          typeof config.data === 'string'
            ? JSON.parse(config.data)
            : config.data,
      };
      outbound.push(req);
      let data: unknown;
      try {
        data = httpResponder(req);
      } finally {
        contractBreaks.push(
          ...contractViolations(req, offContractResponse ? undefined : data)
        );
      }
      return { status: 200, data };
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
  tmdbTv = {
    name: 'Severance',
    original_name: 'Severance',
    first_air_date: '2022-02-18',
    seasons: [tmdbSeason(0), tmdbSeason(1), tmdbSeason(2)],
    external_ids: { imdb_id: 'tt11280740', tvdb_id: 371980 },
  };
  tmdbTvCalls.length = 0;
  outbound = [];
  httpResponder = () => [];
  contractBreaks = [];
  offContractResponse = false;
  fakeHttp();
});

afterEach(() => {
  delete process.env.PROWLARR_URL;
  delete process.env.PROWLARR_API_KEY;
  mock.restoreAll();
  assert.deepStrictEqual(contractBreaks, [], 'breaks the published API');
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
  it('refuses non-admins on every endpoint, without calling out', async () => {
    const agent = await asUser();
    const release = { title: 'x', downloadUrl: 'http://prowlarr/x' };
    const calls = {
      'movie options': () =>
        agent
          .get('/manualsearch/options')
          .query({ mediaType: 'movie', tmdbId: 1 }),
      'TV options': () =>
        agent
          .get('/manualsearch/options')
          .query({ mediaType: 'tv', tmdbId: 1 }),
      search: () =>
        agent
          .get('/manualsearch')
          .query({ mediaType: 'movie', tmdbId: 1, query: 'x' }),
      push: () =>
        agent
          .post('/manualsearch/push')
          .send({ mediaType: 'movie', tmdbId: 1, release }),
      grab: () =>
        agent
          .post('/manualsearch/grab')
          .send({ mediaType: 'tv', tmdbId: 1, release }),
    };
    for (const [name, call] of Object.entries(calls)) {
      const res = await call();
      assert.strictEqual(res.status, 403, name);
    }
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
      inArr: false,
      prowlarrGrabAvailable: false,
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
    httpResponder = () => [
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
    httpResponder = () => {
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

  it('reports Prowlarr unreachable on a failed connection or a server error', async () => {
    const agent = await asAdmin();
    for (const error of [networkError(), httpError(500)]) {
      httpResponder = () => {
        throw error;
      };
      const res = await agent
        .get('/manualsearch')
        .query({ mediaType: 'movie', tmdbId: 915935, query: 'Anatomy' });
      assert.strictEqual(res.status, 502);
      assert.strictEqual(res.body.code, 'PROWLARR_UNREACHABLE');
    }
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
    httpResponder = () => [];
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch')
      .query({ mediaType: 'movie', tmdbId: 915935, query: 'Nothing matches' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { results: [] });
  });
});

function configureRadarr(servers: Partial<RadarrSettings>[]) {
  getSettings().radarr = servers.map((server, i) => ({
    id: i,
    name: `Radarr ${i}`,
    hostname: `radarr${i}`,
    port: 7878,
    apiKey: `radarr-key-${i}`,
    baseUrl: '',
    useSsl: false,
    activeProfileId: 1,
    activeProfileName: 'HD-1080p',
    activeDirectory: '/movies',
    is4k: false,
    minimumAvailability: 'released',
    tags: [],
    isDefault: i === 0,
    syncEnabled: true,
    preventSearch: false,
    externalUrl: '',
    ...server,
  })) as RadarrSettings[];
}

/** A movie Seerr has linked to a Radarr movie, as a sent request leaves it. */
async function linkedMovie(overrides: Partial<Media> = {}) {
  const repository = getRepository(Media);
  return repository.save(
    repository.create({
      mediaType: MediaType.MOVIE,
      tmdbId: 915935,
      imdbId: 'tt17009710',
      status: MediaStatus.PROCESSING,
      serviceId: 0,
      externalServiceId: 42,
      ...overrides,
    })
  );
}

/** A Release as the panel sends it back to push. */
function pushedRelease(overrides: Record<string, unknown> = {}) {
  return {
    guid: 'https://1337x.to/torrent/1',
    indexerId: 3,
    indexer: '1337x',
    title: 'Anatomy.of.a.Fall.2023.1080p.BluRay.x264-PiGNUS',
    size: 11_703_786_291,
    seeders: 214,
    leechers: 12,
    publishDate: '2023-09-20T10:00:00Z',
    downloadUrl: 'http://prowlarr:9696/3/download?link=abc',
    infoUrl: 'https://1337x.to/torrent/1/info',
    ...overrides,
  };
}

/** Radarr's answer to a push: a list holding the evaluated release. */
function radarrDecision(overrides: Record<string, unknown> = {}) {
  return [
    {
      title: 'Anatomy.of.a.Fall.2023.1080p.BluRay.x264-PiGNUS',
      approved: true,
      temporarilyRejected: false,
      rejected: false,
      rejections: [],
      ...overrides,
    },
  ];
}

const pushes = () =>
  outbound.filter((req) => req.uri.endsWith('/api/v3/release/push'));

describe('POST /manualsearch/push', () => {
  beforeEach(() => {
    configureRadarr([{}, { name: 'Radarr Quiet', isDefault: false }]);
    httpResponder = () => radarrDecision();
  });

  afterEach(() => {
    getSettings().radarr = [];
  });

  const push = async (release = pushedRelease()) => {
    const agent = await asAdmin();
    return agent
      .post('/manualsearch/push')
      .send({ mediaType: 'movie', tmdbId: 915935, release });
  };

  it('pushes to the Radarr server the movie was requested on', async () => {
    await linkedMovie({ serviceId: 1 });
    const res = await push();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(pushes().length, 1);
    assert.strictEqual(pushes()[0].method, 'post');
    assert.ok(pushes()[0].uri.startsWith('http://radarr1:7878/api/v3/'));
    assert.strictEqual(pushes()[0].headers['X-Api-Key'], 'radarr-key-1');
  });

  it('sends the Release with the movie IDs and a torrent protocol', async () => {
    await linkedMovie();
    await push();
    assert.deepStrictEqual(pushes()[0].body, {
      title: 'Anatomy.of.a.Fall.2023.1080p.BluRay.x264-PiGNUS',
      protocol: 'torrent',
      publishDate: '2023-09-20T10:00:00Z',
      downloadUrl: 'http://prowlarr:9696/3/download?link=abc',
      guid: 'https://1337x.to/torrent/1',
      size: 11_703_786_291,
      indexer: '1337x',
      infoUrl: 'https://1337x.to/torrent/1/info',
      seeders: 214,
      leechers: 12,
      tmdbId: 915935,
      // Radarr reads imdbId as an int: the digits of tt17009710.
      imdbId: 17009710,
    });
  });

  it('falls back to the default non-4K Radarr when the requested server is gone', async () => {
    configureRadarr([
      { name: 'Radarr 4K', is4k: true, isDefault: true },
      { name: 'Radarr', isDefault: true },
    ]);
    await linkedMovie({ serviceId: 7 });
    const res = await push();
    assert.strictEqual(res.status, 200);
    assert.ok(pushes()[0].uri.startsWith('http://radarr1:7878/'));
  });

  it('falls back to the default Radarr when the movie has no server recorded', async () => {
    await linkedMovie({ serviceId: null });
    await push();
    assert.ok(pushes()[0].uri.startsWith('http://radarr0:7878/'));
  });

  it('reports no Radarr configured when no server matches and none is default', async () => {
    configureRadarr([{ isDefault: false }]);
    await linkedMovie({ serviceId: 5 });
    const res = await push();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'ARR_NOT_CONFIGURED');
    assert.strictEqual(pushes().length, 0);
  });

  it('reports Radarr unreachable on a failed connection or a server error', async () => {
    await linkedMovie();
    for (const error of [networkError(), httpError(500)]) {
      httpResponder = () => {
        throw error;
      };
      const res = await push();
      assert.strictEqual(res.status, 502);
      assert.strictEqual(res.body.code, 'ARR_UNREACHABLE');
    }
  });

  it('answers 409 without pushing when the movie is not in Radarr, or unknown to Seerr', async () => {
    const unknown = await push();
    assert.strictEqual(unknown.status, 409);
    assert.strictEqual(unknown.body.code, 'NOT_IN_ARR');

    await linkedMovie({ externalServiceId: null });
    const unlinked = await push();
    assert.strictEqual(unlinked.status, 409);
    assert.strictEqual(unlinked.body.code, 'NOT_IN_ARR');
    assert.strictEqual(pushes().length, 0);
  });

  it("looks up the IMDb ID from TMDB when Seerr hasn't stored it", async () => {
    tmdbMovie = { ...tmdbMovie, imdb_id: 'tt17009710' };
    await linkedMovie({ imdbId: undefined });
    await push();
    assert.strictEqual(
      (pushes()[0].body as { imdbId?: number }).imdbId,
      17009710
    );
  });

  it('leaves out an IMDb ID Radarr could not read as a number', async () => {
    await linkedMovie({ imdbId: 'not-an-imdb-id' });
    const res = await push();
    assert.strictEqual(res.status, 200);
    // undefined, so JSON drops it rather than sending null.
    assert.strictEqual(
      (pushes()[0].body as { imdbId?: number }).imdbId,
      undefined
    );
  });

  it("sends a magnet-only Release as Prowlarr's proxied downloadUrl, without magnetUrl", async () => {
    await linkedMovie();
    await push(
      pushedRelease({
        downloadUrl: 'http://prowlarr:9696/3/download?link=magnet',
        magnetUrl: 'magnet:?xt=urn:btih:abc',
      })
    );
    const body = pushes()[0].body as Record<string, unknown>;
    assert.strictEqual(
      body.downloadUrl,
      'http://prowlarr:9696/3/download?link=magnet'
    );
    assert.ok(!('magnetUrl' in body));
  });

  it('maps an approved Release to approved', async () => {
    await linkedMovie();
    const res = await push();
    assert.deepStrictEqual(res.body, { status: 'approved' });
  });

  it('maps a temporarily rejected Release to pending, with the reasons', async () => {
    await linkedMovie();
    httpResponder = () =>
      radarrDecision({
        approved: false,
        temporarilyRejected: true,
        rejections: ['Delay profile: release held for 60 minutes'],
      });
    const res = await push();
    assert.deepStrictEqual(res.body, {
      status: 'pending',
      rejections: ['Delay profile: release held for 60 minutes'],
    });
  });

  it('maps a rejected Release to rejected, with the reasons', async () => {
    await linkedMovie();
    httpResponder = () =>
      radarrDecision({
        approved: false,
        rejected: true,
        rejections: [
          'Custom format score -1000 is below the minimum of 0',
          'Language French, English is not wanted',
        ],
      });
    const res = await push();
    assert.deepStrictEqual(res.body, {
      status: 'rejected',
      rejections: [
        'Custom format score -1000 is below the minimum of 0',
        'Language French, English is not wanted',
      ],
    });
  });

  it('maps answers outside the current API too: a single release, { reason } rejections', async () => {
    // Neither shape is in Radarr's or Sonarr's v3 contract: older versions
    // answer with one release, and Sonarr's v5 API sends rejection objects.
    offContractResponse = true;
    await linkedMovie();
    httpResponder = () =>
      radarrDecision({
        approved: false,
        rejected: true,
        rejections: ['No', { reason: 'Language French is not wanted' }],
      })[0];
    const res = await push();
    assert.deepStrictEqual(res.body, {
      status: 'rejected',
      rejections: ['No', 'Language French is not wanted'],
    });
  });

  it('maps an unparseable title (400) to rejected, with the reason', async () => {
    await linkedMovie();
    httpResponder = () => {
      throw httpError(400, [
        { propertyName: 'Title', errorMessage: 'Unable to parse' },
      ]);
    };
    const res = await push();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      status: 'rejected',
      rejections: ['Unable to parse'],
    });
  });

  it('sends every push to Radarr, never answering from a cache', async () => {
    await linkedMovie();
    await push();
    await push();
    assert.strictEqual(pushes().length, 2);
  });
});

describe('GET /manualsearch/options, Radarr link', () => {
  it('reports inArr:true for a movie linked to Radarr', async () => {
    await linkedMovie();
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch/options')
      .query({ mediaType: 'movie', tmdbId: 915935 });
    assert.strictEqual(res.body.inArr, true);
  });

  it('reports inArr:false for a movie unknown to Seerr, or without a Radarr link', async () => {
    const agent = await asAdmin();
    const options = () =>
      agent
        .get('/manualsearch/options')
        .query({ mediaType: 'movie', tmdbId: 915935 });
    assert.strictEqual((await options()).body.inArr, false);
    await linkedMovie({ externalServiceId: null });
    assert.strictEqual((await options()).body.inArr, false);
  });
});

describe('GET /manualsearch/options, TV', () => {
  it('offers the whole series and each regular season as Search Scopes, without Season 0', async () => {
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch/options')
      .query({ mediaType: 'tv', tmdbId: 95396 });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, {
      enabled: true,
      queries: { english: 'Severance' },
      scopes: [
        { query: 'Severance' },
        { season: 1, query: 'Severance S01' },
        { season: 2, query: 'Severance S02' },
      ],
      inArr: false,
      prowlarrGrabAvailable: false,
    });
    assert.deepStrictEqual(tmdbTvCalls, [{ tvId: 95396, language: 'en' }]);
    assert.strictEqual(tmdbCalls.length, 0);
  });

  it('zero-pads season numbers to two digits only', async () => {
    tmdbTv = {
      ...tmdbTv,
      name: 'The Simpsons',
      seasons: [tmdbSeason(9), tmdbSeason(10), tmdbSeason(36)],
    };
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch/options')
      .query({ mediaType: 'tv', tmdbId: 456 });
    assert.deepStrictEqual(
      res.body.scopes.map((scope: { query: string }) => scope.query),
      [
        'The Simpsons',
        'The Simpsons S09',
        'The Simpsons S10',
        'The Simpsons S36',
      ]
    );
  });

  it('leaves out announced seasons that have no episodes yet', async () => {
    tmdbTv = {
      ...tmdbTv,
      seasons: [tmdbSeason(1), { ...tmdbSeason(2), episode_count: 0 }],
    };
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch/options')
      .query({ mediaType: 'tv', tmdbId: 95396 });
    assert.deepStrictEqual(res.body.scopes, [
      { query: 'Severance' },
      { season: 1, query: 'Severance S01' },
    ]);
  });
});

describe('GET /manualsearch, TV', () => {
  it('searches Prowlarr TV categories for the query', async () => {
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch')
      .query({ mediaType: 'tv', tmdbId: 95396, query: 'Severance S02' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(outbound.length, 1);
    const url = new URL(outbound[0].uri);
    assert.strictEqual(url.searchParams.get('query'), 'Severance S02');
    assert.strictEqual(url.searchParams.get('type'), 'search');
    assert.deepStrictEqual(url.searchParams.getAll('categories'), ['5000']);
  });
});

function configureSonarr(servers: Partial<SonarrSettings>[]) {
  getSettings().sonarr = servers.map((server, i) => ({
    id: i,
    name: `Sonarr ${i}`,
    hostname: `sonarr${i}`,
    port: 8989,
    apiKey: `sonarr-key-${i}`,
    baseUrl: '',
    useSsl: false,
    activeProfileId: 1,
    activeProfileName: 'HD-1080p',
    activeDirectory: '/tv',
    is4k: false,
    tags: [],
    isDefault: i === 0,
    syncEnabled: true,
    preventSearch: false,
    externalUrl: '',
    seriesType: 'standard',
    animeSeriesType: 'anime',
    enableSeasonFolders: true,
    monitorNewItems: 'all',
    ...server,
  })) as SonarrSettings[];
}

/** A series Seerr has linked to a Sonarr series, as a sent request leaves it. */
async function linkedSeries(overrides: Partial<Media> = {}) {
  const repository = getRepository(Media);
  return repository.save(
    repository.create({
      mediaType: MediaType.TV,
      tmdbId: 95396,
      tvdbId: 371980,
      imdbId: 'tt11280740',
      status: MediaStatus.PROCESSING,
      serviceId: 0,
      externalServiceId: 17,
      ...overrides,
    })
  );
}

const pushedEpisodeRelease = () =>
  pushedRelease({
    guid: 'https://1337x.to/torrent/2',
    title: 'Severance.S02.1080p.ATVP.WEB-DL.DDP5.1.H.264-NTb',
    size: 31_000_000_000,
    downloadUrl: 'http://prowlarr:9696/3/download?link=sev',
    infoUrl: 'https://1337x.to/torrent/2/info',
  });

describe('POST /manualsearch/push, TV', () => {
  beforeEach(() => {
    configureSonarr([{}, { name: 'Sonarr Quiet', isDefault: false }]);
    httpResponder = () => radarrDecision();
  });

  afterEach(() => {
    getSettings().sonarr = [];
  });

  const push = async (release = pushedEpisodeRelease()) => {
    const agent = await asAdmin();
    return agent
      .post('/manualsearch/push')
      .send({ mediaType: 'tv', tmdbId: 95396, release });
  };

  it('pushes to the Sonarr server the series was requested on', async () => {
    await linkedSeries({ serviceId: 1 });
    const res = await push();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(pushes().length, 1);
    assert.strictEqual(pushes()[0].method, 'post');
    assert.ok(pushes()[0].uri.startsWith('http://sonarr1:8989/api/v3/'));
    assert.strictEqual(pushes()[0].headers['X-Api-Key'], 'sonarr-key-1');
  });

  it('sends the Release with the series tvdbId/imdbId and no tmdbId', async () => {
    await linkedSeries();
    await push();
    assert.deepStrictEqual(pushes()[0].body, {
      title: 'Severance.S02.1080p.ATVP.WEB-DL.DDP5.1.H.264-NTb',
      protocol: 'torrent',
      publishDate: '2023-09-20T10:00:00Z',
      downloadUrl: 'http://prowlarr:9696/3/download?link=sev',
      guid: 'https://1337x.to/torrent/2',
      size: 31_000_000_000,
      indexer: '1337x',
      infoUrl: 'https://1337x.to/torrent/2/info',
      seeders: 214,
      leechers: 12,
      tvdbId: 371980,
      imdbId: 'tt11280740',
    });
  });

  it("looks up the TVDB and IMDb IDs from TMDB when Seerr hasn't stored them", async () => {
    await linkedSeries({ tvdbId: undefined, imdbId: undefined });
    await push();
    const body = pushes()[0].body as Record<string, unknown>;
    assert.strictEqual(body.tvdbId, 371980);
    assert.strictEqual(body.imdbId, 'tt11280740');
  });

  it('never pushes a series to Radarr', async () => {
    configureRadarr([{}]);
    try {
      await linkedSeries();
      await push();
      assert.strictEqual(pushes().length, 1);
      assert.ok(pushes()[0].uri.startsWith('http://sonarr0:8989/'));
    } finally {
      getSettings().radarr = [];
    }
  });

  it('does not treat a movie with the same TMDB ID as the series', async () => {
    await linkedMovie({ tmdbId: 95396 });
    const res = await push();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'NOT_IN_ARR');
    assert.strictEqual(pushes().length, 0);
  });
});

describe('GET /manualsearch/options, Sonarr link', () => {
  it('reports inArr:true for a series linked to Sonarr', async () => {
    await linkedSeries();
    const agent = await asAdmin();
    const res = await agent
      .get('/manualsearch/options')
      .query({ mediaType: 'tv', tmdbId: 95396 });
    assert.strictEqual(res.body.inArr, true);
  });
});

/** Prowlarr's download clients, as `GET /api/v1/downloadclient` lists them. */
const PROWLARR_CLIENTS = [
  { id: 1, name: 'qBittorrent Radarr', implementation: 'QBittorrent' },
  { id: 2, name: 'qBittorrent Sonarr', implementation: 'QBittorrent' },
];

const clientLookups = () =>
  outbound.filter((req) => req.uri.endsWith('/api/v1/downloadclient'));
const grabs = () =>
  outbound.filter(
    (req) => req.method === 'post' && req.uri.endsWith('/api/v1/search')
  );

/** Prowlarr answers the client list, and a grab with the grabbed release. */
function prowlarrResponder(req: OutboundRequest) {
  if (req.uri.endsWith('/api/v1/downloadclient')) {
    return PROWLARR_CLIENTS;
  }
  return { guid: 'https://1337x.to/torrent/1', indexerId: 3 };
}

describe('POST /manualsearch/grab', () => {
  beforeEach(() => {
    process.env.PROWLARR_MOVIE_CLIENT = 'qBittorrent Radarr';
    process.env.PROWLARR_TV_CLIENT = 'qBittorrent Sonarr';
    httpResponder = prowlarrResponder;
  });

  afterEach(() => {
    delete process.env.PROWLARR_MOVIE_CLIENT;
    delete process.env.PROWLARR_TV_CLIENT;
  });

  const grab = async (release = pushedRelease()) => {
    const agent = await asAdmin();
    return agent
      .post('/manualsearch/grab')
      .send({ mediaType: 'movie', tmdbId: 915935, release });
  };

  it('grabs through the Prowlarr client named for movies', async () => {
    await linkedMovie();
    const res = await grab();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { status: 'grabbed' });
    assert.strictEqual(grabs().length, 1);
    assert.strictEqual(grabs()[0].uri, `${PROWLARR_URL}/api/v1/search`);
    assert.strictEqual(grabs()[0].headers['X-Api-Key'], PROWLARR_API_KEY);
    assert.deepStrictEqual(grabs()[0].body, {
      guid: 'https://1337x.to/torrent/1',
      indexerId: 3,
      downloadClientId: 1,
    });
  });

  it('answers 409 without grabbing when the movie client env var is unset', async () => {
    delete process.env.PROWLARR_MOVIE_CLIENT;
    await linkedMovie();
    const res = await grab();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'GRAB_UNAVAILABLE');
    assert.strictEqual(grabs().length, 0);
  });

  it('answers 409 without grabbing when Prowlarr has no client by that name', async () => {
    process.env.PROWLARR_MOVIE_CLIENT = 'qbittorrent radarr';
    await linkedMovie();
    const res = await grab();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'GRAB_UNAVAILABLE');
    assert.strictEqual(grabs().length, 0);
  });

  it('answers 409 without asking Prowlarr when the movie is not in Radarr, or unknown to Seerr', async () => {
    const unknown = await grab();
    assert.strictEqual(unknown.status, 409);
    assert.strictEqual(unknown.body.code, 'NOT_IN_ARR');

    await linkedMovie({ externalServiceId: null });
    const unlinked = await grab();
    assert.strictEqual(unlinked.status, 409);
    assert.strictEqual(unlinked.body.code, 'NOT_IN_ARR');
    assert.strictEqual(outbound.length, 0);
  });

  it("answers 410 when the Release dropped out of Prowlarr's search cache", async () => {
    await linkedMovie();
    httpResponder = (req) => {
      if (req.method === 'post') {
        throw httpError(404, {
          message:
            "Couldn't find requested release in cache, cache timeout probably expired.",
        });
      }
      return prowlarrResponder(req);
    };
    const res = await grab();
    assert.strictEqual(res.status, 410);
    assert.strictEqual(res.body.code, 'SEARCH_EXPIRED');
  });

  it('reports the grab failed when Prowlarr refuses it', async () => {
    await linkedMovie();
    httpResponder = (req) => {
      if (req.method === 'post') {
        throw httpError(409, {
          message: 'Getting release from indexer failed',
        });
      }
      return prowlarrResponder(req);
    };
    const res = await grab();
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.code, 'GRAB_FAILED');
    assert.match(res.body.message, /Getting release from indexer failed/);
  });

  it('reports Prowlarr unreachable when the connection fails', async () => {
    await linkedMovie();
    httpResponder = () => {
      throw networkError();
    };
    const res = await grab();
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.code, 'PROWLARR_UNREACHABLE');
  });

  it('refuses to grab when Prowlarr is not configured', async () => {
    delete process.env.PROWLARR_URL;
    await linkedMovie();
    const res = await grab();
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.code, 'DISABLED');
    assert.strictEqual(outbound.length, 0);
  });

  it('sends every grab to Prowlarr, never answering from a cache', async () => {
    await linkedMovie();
    await grab();
    await grab();
    assert.strictEqual(grabs().length, 2);
  });
});

describe('POST /manualsearch/grab, TV', () => {
  beforeEach(() => {
    process.env.PROWLARR_MOVIE_CLIENT = 'qBittorrent Radarr';
    process.env.PROWLARR_TV_CLIENT = 'qBittorrent Sonarr';
    httpResponder = prowlarrResponder;
  });

  afterEach(() => {
    delete process.env.PROWLARR_MOVIE_CLIENT;
    delete process.env.PROWLARR_TV_CLIENT;
  });

  const grab = async () => {
    const agent = await asAdmin();
    return agent.post('/manualsearch/grab').send({
      mediaType: 'tv',
      tmdbId: 95396,
      release: pushedEpisodeRelease(),
    });
  };

  it('grabs through the Prowlarr client named for TV', async () => {
    await linkedSeries();
    const res = await grab();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body, { status: 'grabbed' });
    assert.deepStrictEqual(grabs()[0].body, {
      guid: 'https://1337x.to/torrent/2',
      indexerId: 3,
      downloadClientId: 2,
    });
  });

  it('answers 409 when only the movie client is set', async () => {
    delete process.env.PROWLARR_TV_CLIENT;
    await linkedSeries();
    const res = await grab();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'GRAB_UNAVAILABLE');
    assert.strictEqual(grabs().length, 0);
  });
});

describe('GET /manualsearch/options, Prowlarr Grab', () => {
  beforeEach(() => {
    process.env.PROWLARR_MOVIE_CLIENT = 'qBittorrent Radarr';
    process.env.PROWLARR_TV_CLIENT = 'qBittorrent Sonarr';
    httpResponder = prowlarrResponder;
  });

  afterEach(() => {
    delete process.env.PROWLARR_MOVIE_CLIENT;
    delete process.env.PROWLARR_TV_CLIENT;
  });

  const options = async (mediaType: 'movie' | 'tv') => {
    const agent = await asAdmin();
    return agent
      .get('/manualsearch/options')
      .query({ mediaType, tmdbId: mediaType === 'tv' ? 95396 : 915935 });
  };

  it('reports the grab available for a movie in Radarr whose client exists', async () => {
    await linkedMovie();
    const res = await options('movie');
    assert.strictEqual(res.body.prowlarrGrabAvailable, true);
    assert.strictEqual(clientLookups().length, 1);
  });

  it('reports it unavailable when the movie client env var is unset', async () => {
    delete process.env.PROWLARR_MOVIE_CLIENT;
    await linkedMovie();
    const res = await options('movie');
    assert.strictEqual(res.body.prowlarrGrabAvailable, false);
  });

  it('reports it unavailable when Prowlarr has no client by that name', async () => {
    process.env.PROWLARR_MOVIE_CLIENT = 'Transmission';
    await linkedMovie();
    const res = await options('movie');
    assert.strictEqual(res.body.prowlarrGrabAvailable, false);
  });

  it('reports it unavailable, without asking Prowlarr, for a movie not in Radarr', async () => {
    await linkedMovie({ externalServiceId: null });
    const res = await options('movie');
    assert.strictEqual(res.body.prowlarrGrabAvailable, false);
    assert.strictEqual(clientLookups().length, 0);
  });

  it('reports it unavailable, rather than failing, when Prowlarr is unreachable', async () => {
    await linkedMovie();
    httpResponder = () => {
      throw networkError();
    };
    const res = await options('movie');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.enabled, true);
    assert.strictEqual(res.body.prowlarrGrabAvailable, false);
  });

  it('reports the grab available for a series in Sonarr whose client exists', async () => {
    await linkedSeries();
    const res = await options('tv');
    assert.strictEqual(res.body.prowlarrGrabAvailable, true);
  });

  it('reports it unavailable for a series when only the movie client is set', async () => {
    delete process.env.PROWLARR_TV_CLIENT;
    await linkedSeries();
    const res = await options('tv');
    assert.strictEqual(res.body.prowlarrGrabAvailable, false);
  });
});
