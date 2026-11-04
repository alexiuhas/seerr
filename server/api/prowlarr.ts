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

/** Prowlarr's parent categories; it expands each to its subcategories. */
export const PROWLARR_MOVIE_CATEGORY = 2000;

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
}

export default ProwlarrAPI;
