import type { Release } from '@server/interfaces/api/manualSearchInterfaces';

export type ReleaseSortKey = 'seeders' | 'size' | 'age';
export type SortDirection = 'asc' | 'desc';

/** How the Release list is ordered; the direction is by the sorted value. */
export interface ReleaseSort {
  key: ReleaseSortKey;
  direction: SortDirection;
}

// Each key starts in its most useful direction: most seeders, smallest,
// newest (fewest days old).
const DEFAULT_DIRECTION: Record<ReleaseSortKey, SortDirection> = {
  seeders: 'desc',
  size: 'asc',
  age: 'asc',
};

export const DEFAULT_SORT: ReleaseSort = {
  key: 'seeders',
  direction: DEFAULT_DIRECTION.seeders,
};

/**
 * The sort after picking `key`: the same key again flips its direction,
 * another key starts in its default direction.
 */
export const nextSort = (
  current: ReleaseSort,
  key: ReleaseSortKey
): ReleaseSort =>
  current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: DEFAULT_DIRECTION[key] };

const sortValue: Record<ReleaseSortKey, (release: Release) => number> = {
  seeders: (release) => release.seeders,
  size: (release) => release.size,
  age: (release) => release.ageDays,
};

/** Narrows Releases by a case-insensitive text filter, then sorts them. */
export const sortAndFilterReleases = (
  releases: Release[],
  sort: ReleaseSort,
  filter: string
): Release[] => {
  const needle = filter.trim().toLowerCase();
  const matching = needle
    ? releases.filter((release) =>
        [release.title, release.indexer, ...release.categories]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      )
    : releases;
  const value = sortValue[sort.key];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...matching].sort((a, b) => sign * (value(a) - value(b)));
};

/**
 * Where a Release card stands in its Push to Radarr/Sonarr, and in the
 * Prowlarr Grab that may follow a rejection.
 */
export type CardState =
  | { status: 'idle' }
  | { status: 'pushing' }
  | { status: 'approved' }
  | { status: 'pending' }
  | { status: 'rejected'; rejections: string[] }
  | { status: 'prowlarrGrabbing'; rejections: string[] }
  | { status: 'prowlarrGrabbed' };

export const releaseKey = (release: Release) =>
  `${release.indexerId}-${release.guid}`;
