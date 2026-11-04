import type { ProwlarrRelease } from '@server/api/prowlarr';
import ProwlarrAPI, {
  getProwlarrConfig,
  PROWLARR_MOVIE_CATEGORY,
} from '@server/api/prowlarr';
import ReleasePushAPI from '@server/api/releasePush';
import RadarrAPI from '@server/api/servarr/radarr';
import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type {
  ManualSearchQueries,
  PushableRelease,
  PushOutcome,
  Release,
} from '@server/interfaces/api/manualSearchInterfaces';
import { getSettings } from '@server/lib/settings';

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

/** The movie has no Radarr link, so Radarr would have nothing to match it to. */
export class NotInArrError extends Error {
  constructor() {
    super('The movie is not in Radarr yet');
    this.name = 'NotInArrError';
  }
}

/** Neither the movie's server nor a default non-4K Radarr is configured. */
export class ArrNotConfiguredError extends Error {
  constructor() {
    super('No Radarr server is configured for this movie');
    this.name = 'ArrNotConfiguredError';
  }
}

const findMovie = (tmdbId: number) =>
  getRepository(Media).findOne({
    where: { tmdbId, mediaType: MediaType.MOVIE },
  });

/** Whether Seerr has linked the movie to a Radarr movie (non-4K). */
export async function isMovieInArr(tmdbId: number): Promise<boolean> {
  const media = await findMovie(tmdbId);
  return media?.externalServiceId != null;
}

/**
 * The Radarr server holding the movie: the one it was requested on (a Quiet
 * Server included), else the default non-4K one.
 */
function resolveRadarr(media: Media) {
  const servers = getSettings().radarr;
  return (
    servers.find((server) => server.id === media.serviceId) ??
    servers.find((server) => server.isDefault && !server.is4k)
  );
}

async function movieImdbId(media: Media): Promise<string | undefined> {
  if (media.imdbId) {
    return media.imdbId;
  }
  try {
    const movie = await new TheMovieDb().getMovie({ movieId: media.tmdbId });
    return movie.imdb_id || undefined;
  } catch {
    // The IDs only help Radarr match; the Push can go without them.
    return undefined;
  }
}

/** Pushes a Release to the Radarr server that holds the movie. */
export async function pushMovieRelease(
  tmdbId: number,
  release: PushableRelease
): Promise<PushOutcome> {
  const media = await findMovie(tmdbId);
  if (media?.externalServiceId == null) {
    throw new NotInArrError();
  }
  const server = resolveRadarr(media);
  if (!server) {
    throw new ArrNotConfiguredError();
  }
  const api = new ReleasePushAPI({
    url: RadarrAPI.buildUrl(server, '/api/v3'),
    apiKey: server.apiKey,
  });
  // Built field by field: only what Radarr needs, and never a magnetUrl, which
  // Radarr would reject for Prowlarr's proxied http link.
  return api.push({
    title: release.title,
    protocol: 'torrent',
    publishDate: release.publishDate,
    downloadUrl: release.downloadUrl ?? '',
    guid: release.guid,
    size: release.size,
    indexer: release.indexer,
    infoUrl: release.infoUrl,
    seeders: release.seeders,
    leechers: release.leechers,
    tmdbId: media.tmdbId,
    imdbId: await movieImdbId(media),
  });
}
