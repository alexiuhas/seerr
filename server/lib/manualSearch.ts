import type { ProwlarrRelease } from '@server/api/prowlarr';
import ProwlarrAPI, {
  getProwlarrConfig,
  PROWLARR_MOVIE_CATEGORY,
} from '@server/api/prowlarr';
import TheMovieDb from '@server/api/themoviedb';
import type {
  ManualSearchQueries,
  Release,
} from '@server/interfaces/api/manualSearchInterfaces';

const withYear = (title: string, year?: string) =>
  year ? `${title} ${year}` : title;

/**
 * The prefilled queries for a movie. Titles are always fetched in English,
 * whatever the admin's locale, because indexers name releases that way.
 */
export async function getMovieQueries(
  tmdbId: number
): Promise<ManualSearchQueries> {
  const movie = await new TheMovieDb().getMovie({
    movieId: tmdbId,
    language: 'en',
  });
  const year = movie.release_date?.slice(0, 4) || undefined;
  const queries: ManualSearchQueries = {
    english: withYear(movie.title, year),
  };
  if (movie.original_title && movie.original_title !== movie.title) {
    queries.original = withYear(movie.original_title, year);
  }
  return queries;
}

// Newznab standard categories are below 100000; above are indexer-specific.
const MAX_STANDARD_CATEGORY = 100000;

const toRelease = (release: ProwlarrRelease): Release => ({
  guid: release.guid,
  indexerId: release.indexerId,
  indexer: release.indexer,
  title: release.title,
  size: release.size,
  seeders: release.seeders ?? 0,
  leechers: release.leechers ?? 0,
  publishDate: release.publishDate,
  ageDays: release.age,
  categories: release.categories
    .filter((category) => category.id < MAX_STANDARD_CATEGORY)
    .map((category) => category.name),
  downloadUrl: release.downloadUrl,
  infoUrl: release.infoUrl,
});

export class ManualSearchDisabledError extends Error {
  constructor() {
    super('Prowlarr is not configured');
    this.name = 'ManualSearchDisabledError';
  }
}

export async function searchMovieReleases(query: string): Promise<Release[]> {
  const config = getProwlarrConfig();
  if (!config) {
    throw new ManualSearchDisabledError();
  }
  const releases = await new ProwlarrAPI(config).search(query, [
    PROWLARR_MOVIE_CATEGORY,
  ]);
  return releases.map(toRelease);
}
