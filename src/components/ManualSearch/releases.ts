import type { Release } from '@server/interfaces/api/manualSearchInterfaces';

export type ReleaseSort = 'seeders' | 'size' | 'age';

const comparators: Record<ReleaseSort, (a: Release, b: Release) => number> = {
  // most seeders first
  seeders: (a, b) => b.seeders - a.seeders,
  // smallest first
  size: (a, b) => a.size - b.size,
  // newest first
  age: (a, b) => a.ageDays - b.ageDays,
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
  return [...matching].sort(comparators[sort]);
};
