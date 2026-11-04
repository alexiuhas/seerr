export interface ManualSearchQueries {
  english: string;
  original?: string;
}

export interface ManualSearchOptionsResponse {
  enabled: boolean;
  queries?: ManualSearchQueries;
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

export type ManualSearchErrorCode =
  | 'DISABLED'
  | 'INDEXERS_UNAVAILABLE'
  | 'PROWLARR_UNREACHABLE';

export interface ManualSearchErrorResponse {
  code: ManualSearchErrorCode;
  message: string;
}
