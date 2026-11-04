export interface ManualSearchQueries {
  english: string;
  original?: string;
}

export type ManualSearchMediaType = 'movie' | 'tv';

/** Where a Push goes: Radarr for movies, Sonarr for series. */
export type ArrName = 'Radarr' | 'Sonarr';

/**
 * What a Manual Search on a series targets: the whole series (no season) or
 * a single regular season.
 */
export interface SearchScope {
  season?: number;
  query: string;
}

export interface ManualSearchOptionsResponse {
  enabled: boolean;
  queries?: ManualSearchQueries;
  /** TV only: the whole series first, then each regular season. */
  scopes?: SearchScope[];
  /**
   * Whether the item is linked to a Radarr movie or Sonarr series, so it can
   * be Pushed.
   */
  inArr?: boolean;
  /**
   * Whether a rejected Push can fall back to a Prowlarr Grab: the item is in
   * Radarr/Sonarr and Prowlarr has the download client named for its media
   * type.
   */
  prowlarrGrabAvailable?: boolean;
}

/** A single torrent offered by an indexer, as returned by a Manual Search. */
export interface Release {
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  publishDate: string;
  ageDays: number;
  categories: string[];
  downloadUrl?: string;
  infoUrl?: string;
}

export interface ManualSearchResponse {
  results: Release[];
}

/** The fields of a Release that a Push sends on to Radarr/Sonarr. */
export type PushableRelease = Pick<
  Release,
  | 'guid'
  | 'title'
  | 'publishDate'
  | 'downloadUrl'
  | 'size'
  | 'indexer'
  | 'infoUrl'
  | 'seeders'
  | 'leechers'
>;

/** The fields of a Release that a Prowlarr Grab needs. */
export type GrabbableRelease = Pick<Release, 'guid' | 'indexerId'>;

export interface GrabRequestBody {
  mediaType: ManualSearchMediaType;
  tmdbId: number;
  release: GrabbableRelease;
}

export interface GrabOutcome {
  status: 'grabbed';
}

export interface PushRequestBody {
  mediaType: ManualSearchMediaType;
  tmdbId: number;
  release: PushableRelease;
}

/** Radarr's or Sonarr's verdict on a Pushed Release. */
export type PushOutcome =
  | { status: 'approved' }
  | { status: 'pending'; rejections: string[] }
  | { status: 'rejected'; rejections: string[] };

export type ManualSearchErrorCode =
  | 'DISABLED'
  | 'INDEXERS_UNAVAILABLE'
  | 'PROWLARR_UNREACHABLE'
  | 'NOT_IN_ARR'
  | 'ARR_NOT_CONFIGURED'
  | 'ARR_UNREACHABLE'
  | 'GRAB_UNAVAILABLE'
  | 'GRAB_FAILED'
  | 'SEARCH_EXPIRED';

export interface ManualSearchErrorResponse {
  code: ManualSearchErrorCode;
  message: string;
}
