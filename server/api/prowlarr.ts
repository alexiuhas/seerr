import ExternalAPI from '@server/api/externalapi';
import axios from 'axios';

export interface ProwlarrConfig {
  url: string;
  apiKey: string;
}

/** Prowlarr is configured from env vars only (ADR-0001). */
export function getProwlarrConfig(): ProwlarrConfig | null {
  const url = process.env.PROWLARR_URL;
  const apiKey = process.env.PROWLARR_API_KEY;
  if (!url || !apiKey) {
    return null;
  }
  return { url: url.replace(/\/+$/, ''), apiKey };
}

export interface ProwlarrCategory {
  id: number;
  name: string;
}

export interface ProwlarrRelease {
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  size: number;
  seeders?: number;
  leechers?: number;
  publishDate: string;
  age: number;
  protocol: 'torrent' | 'usenet' | 'unknown';
  categories: ProwlarrCategory[];
  downloadUrl?: string;
  magnetUrl?: string;
  infoUrl?: string;
}

/** Prowlarr answered 400: every indexer it tried failed. */
export class IndexersUnavailableError extends Error {
  constructor(message?: string) {
    super(message ?? 'All indexers are unavailable');
    this.name = 'IndexersUnavailableError';
  }
}

/** Prowlarr couldn't be reached, or failed in an unexpected way. */
export class ProwlarrUnreachableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProwlarrUnreachableError';
  }
}

/** Prowlarr no longer has the Release in its search cache (~30 minutes). */
export class SearchExpiredError extends Error {
  constructor() {
    super('The search results expired; search again');
    this.name = 'SearchExpiredError';
  }
}

/** Prowlarr refused the grab, e.g. the indexer or download client failed. */
export class GrabFailedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GrabFailedError';
  }
}

export interface ProwlarrDownloadClient {
  id: number;
  name: string;
}

/** Prowlarr's parent categories; it expands each to its subcategories. */
export const PROWLARR_MOVIE_CATEGORY = 2000;
export const PROWLARR_TV_CATEGORY = 5000;

class ProwlarrAPI extends ExternalAPI {
  constructor({ url, apiKey }: ProwlarrConfig) {
    // No cache store: search results must always be fresh.
    super(url, {}, { headers: { 'X-Api-Key': apiKey } });
  }

  /** A free-text search, returning torrent Releases only. */
  public async search(
    query: string,
    categories: number[]
  ): Promise<ProwlarrRelease[]> {
    try {
      const response = await this.axios.get<ProwlarrRelease[]>(
        '/api/v1/search',
        {
          params: { query, type: 'search', categories, limit: 100 },
          // Prowlarr wants `categories=2000&categories=5000`, not `categories[]=`
          paramsSerializer: { indexes: null },
        }
      );
      return response.data.filter((release) => release.protocol === 'torrent');
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 400) {
        throw new IndexersUnavailableError(e.response.data?.message);
      }
      throw new ProwlarrUnreachableError(
        `[Prowlarr] Search failed: ${e.message}`,
        { cause: e }
      );
    }
  }

  /** The id of the download client with exactly this name, if any. */
  public async findDownloadClientId(name: string): Promise<number | undefined> {
    try {
      const response = await this.axios.get<ProwlarrDownloadClient[]>(
        '/api/v1/downloadclient'
      );
      return response.data.find((client) => client.name === name)?.id;
    } catch (e) {
      throw new ProwlarrUnreachableError(
        `[Prowlarr] Listing download clients failed: ${e.message}`,
        { cause: e }
      );
    }
  }

  /**
   * Sends a Release from a recent search straight to a download client. Posts
   * through axios directly, so a grab is never answered from a cache.
   */
  public async grab(release: {
    guid: string;
    indexerId: number;
    downloadClientId: number;
  }): Promise<void> {
    try {
      await this.axios.post('/api/v1/search', release);
    } catch (e) {
      if (axios.isAxiosError(e) && e.response) {
        // 404: the Release dropped out of Prowlarr's search cache.
        if (e.response.status === 404) {
          throw new SearchExpiredError();
        }
        throw new GrabFailedError(
          `[Prowlarr] Grab failed: ${e.response.data?.message ?? e.message}`,
          { cause: e }
        );
      }
      throw new ProwlarrUnreachableError(
        `[Prowlarr] Grab failed: ${e.message}`,
        { cause: e }
      );
    }
  }
}

export default ProwlarrAPI;
