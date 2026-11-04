import type { ProwlarrRelease } from '@server/api/prowlarr';
import ProwlarrAPI, {
  getProwlarrConfig,
  PROWLARR_MOVIE_CATEGORY,
  PROWLARR_TV_CATEGORY,
} from '@server/api/prowlarr';
import type { ReleasePushBody } from '@server/api/releasePush';
import ReleasePushAPI from '@server/api/releasePush';
import ServarrBase from '@server/api/servarr/base';
import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type {
  ArrName,
  GrabbableRelease,
  GrabOutcome,
  ManualSearchMediaType,
  ManualSearchOptionsResponse,
  ManualSearchQueries,
  PushableRelease,
  PushOutcome,
  Release,
  SearchScope,
} from '@server/interfaces/api/manualSearchInterfaces';
import type { DVRSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';

/** Everything that differs between a movie and a series Manual Search. */
interface MediaProfile {
  noun: 'movie' | 'series';
  arr: ArrName;
  category: number;
  /** The env var naming the Prowlarr download client for a Prowlarr Grab. */
  grabClientEnv: 'PROWLARR_MOVIE_CLIENT' | 'PROWLARR_TV_CLIENT';
  mediaType: MediaType;
  servers: () => DVRSettings[];
  /** The IDs that help Radarr/Sonarr match a Release whose title parses. */
  externalIds: (
    media: Media
  ) => Promise<Pick<ReleasePushBody, 'tmdbId' | 'tvdbId' | 'imdbId'>>;
}

// The IDs only help matching, so a failed TMDB lookup leaves them out rather
// than failing the Push.
const orNothing = async <T>(lookup: () => Promise<T>): Promise<Partial<T>> => {
  try {
    return await lookup();
  } catch {
    return {};
  }
};

/** Radarr's push reads imdbId as an int, so `tt0137523` goes as 137523. */
const radarrImdbId = (imdbId?: string) => {
  const digits = imdbId?.match(/^tt(\d+)$/)?.[1];
  return digits ? Number(digits) : undefined;
};

const PROFILES: Record<ManualSearchMediaType, MediaProfile> = {
  movie: {
    noun: 'movie',
    arr: 'Radarr',
    category: PROWLARR_MOVIE_CATEGORY,
    grabClientEnv: 'PROWLARR_MOVIE_CLIENT',
    mediaType: MediaType.MOVIE,
    servers: () => getSettings().radarr,
    externalIds: async (media) => ({
      tmdbId: media.tmdbId,
      imdbId: radarrImdbId(
        media.imdbId ??
          (
            await orNothing(async () => {
              const movie = await new TheMovieDb().getMovie({
                movieId: media.tmdbId,
              });
              return { imdbId: movie.imdb_id || undefined };
            })
          ).imdbId
      ),
    }),
  },
  tv: {
    noun: 'series',
    arr: 'Sonarr',
    category: PROWLARR_TV_CATEGORY,
    grabClientEnv: 'PROWLARR_TV_CLIENT',
    mediaType: MediaType.TV,
    servers: () => getSettings().sonarr,
    externalIds: async (media) => {
      // Seerr doesn't always store them; TMDB fills the gaps.
      const looked =
        media.tvdbId && media.imdbId
          ? {}
          : await orNothing(async () => {
              const { external_ids: ids } = await new TheMovieDb().getTvShow({
                tvId: media.tmdbId,
              });
              return {
                tvdbId: ids?.tvdb_id || undefined,
                imdbId: ids?.imdb_id || undefined,
              };
            });
      return {
        tvdbId: media.tvdbId ?? looked.tvdbId,
        imdbId: media.imdbId ?? looked.imdbId,
      };
    },
  },
};

const withYear = (title: string, year?: string) =>
  year ? `${title} ${year}` : title;

/**
 * The prefilled queries for a movie. Titles are always fetched in English,
 * whatever the admin's locale, because indexers name releases that way.
 */
async function getMovieQueries(tmdbId: number): Promise<ManualSearchQueries> {
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

/**
 * The Search Scopes for a series: the whole series (`{title}`), then each
 * regular season (`{title} SNN`). Season 0 (specials) and seasons without
 * episodes yet are left out. The title is fetched in English, like a
 * movie's.
 */
async function getSeriesScopes(tmdbId: number): Promise<SearchScope[]> {
  const series = await new TheMovieDb().getTvShow({
    tvId: tmdbId,
    language: 'en',
  });
  // Like the series page: no specials, no announced-but-empty seasons.
  const seasons = (series.seasons ?? [])
    .filter((season) => season.season_number > 0 && season.episode_count > 0)
    .map((season) => season.season_number)
    .sort((a, b) => a - b);
  return [
    { query: series.name },
    ...seasons.map((season) => ({
      season,
      query: `${series.name} S${String(season).padStart(2, '0')}`,
    })),
  ];
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

/** Searches Prowlarr in the movie (2000) or TV (5000) categories. */
export async function searchReleases(
  mediaType: ManualSearchMediaType,
  query: string
): Promise<Release[]> {
  const config = getProwlarrConfig();
  if (!config) {
    throw new ManualSearchDisabledError();
  }
  const releases = await new ProwlarrAPI(config).search(query, [
    PROFILES[mediaType].category,
  ]);
  return releases.map(toRelease);
}

/** The item has no Radarr/Sonarr link, so there is nothing to match it to. */
export class NotInArrError extends Error {
  constructor({ noun, arr }: MediaProfile) {
    super(`The ${noun} is not in ${arr} yet`);
    this.name = 'NotInArrError';
  }
}

/** Neither the item's server nor a default non-4K one is configured. */
export class ArrNotConfiguredError extends Error {
  constructor({ noun, arr }: MediaProfile) {
    super(`No ${arr} server is configured for this ${noun}`);
    this.name = 'ArrNotConfiguredError';
  }
}

const findMedia = (profile: MediaProfile, tmdbId: number) =>
  getRepository(Media).findOne({
    where: { tmdbId, mediaType: profile.mediaType },
  });

/**
 * Whether Seerr has linked the item to a Radarr movie or Sonarr series
 * (non-4K).
 */
async function isInArr(profile: MediaProfile, tmdbId: number) {
  const media = await findMedia(profile, tmdbId);
  return media?.externalServiceId != null;
}

/**
 * Whether a rejected Push can fall back to a Prowlarr Grab. Never for items
 * outside Radarr/Sonarr; an unreachable Prowlarr just hides the button.
 */
async function isGrabAvailable(profile: MediaProfile, inArr: boolean) {
  const config = getProwlarrConfig();
  if (!inArr || !config) {
    return false;
  }
  try {
    return (
      (await resolveGrabClientId(new ProwlarrAPI(config), profile)) != null
    );
  } catch {
    return false;
  }
}

/**
 * What the panel opens with: prefilled queries, Search Scopes, Push and
 * Prowlarr Grab state.
 */
export async function getManualSearchOptions(
  mediaType: ManualSearchMediaType,
  tmdbId: number
): Promise<ManualSearchOptionsResponse> {
  const profile = PROFILES[mediaType];
  const arrState = isInArr(profile, tmdbId).then(async (inArr) => ({
    inArr,
    prowlarrGrabAvailable: await isGrabAvailable(profile, inArr),
  }));
  if (mediaType === 'tv') {
    const [scopes, state] = await Promise.all([
      getSeriesScopes(tmdbId),
      arrState,
    ]);
    // the first scope is always the whole series
    return {
      enabled: true,
      queries: { english: scopes[0].query },
      scopes,
      ...state,
    };
  }
  const [queries, state] = await Promise.all([
    getMovieQueries(tmdbId),
    arrState,
  ]);
  return { enabled: true, queries, ...state };
}

/**
 * The Radarr/Sonarr server holding the item: the one it was requested on (a
 * Quiet Server included), else the default non-4K one.
 */
function resolveServer(profile: MediaProfile, media: Media) {
  const servers = profile.servers();
  return (
    servers.find((server) => server.id === media.serviceId) ??
    servers.find((server) => server.isDefault && !server.is4k)
  );
}

/** Pushes a Release to the Radarr/Sonarr server that holds the item. */
export async function pushRelease(
  mediaType: ManualSearchMediaType,
  tmdbId: number,
  release: PushableRelease
): Promise<PushOutcome> {
  const profile = PROFILES[mediaType];
  const media = await findMedia(profile, tmdbId);
  if (media?.externalServiceId == null) {
    throw new NotInArrError(profile);
  }
  const server = resolveServer(profile, media);
  if (!server) {
    throw new ArrNotConfiguredError(profile);
  }
  const api = new ReleasePushAPI({
    url: ServarrBase.buildUrl(server, '/api/v3'),
    apiKey: server.apiKey,
    name: profile.arr,
  });
  // Built field by field: only what Radarr/Sonarr need, and never a magnetUrl,
  // which they would reject for Prowlarr's proxied http link.
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
    ...(await profile.externalIds(media)),
  });
}

/**
 * No Prowlarr Grab for this media type: its client env var is unset, or
 * Prowlarr has no download client by that name.
 */
export class GrabUnavailableError extends Error {
  constructor({ noun }: MediaProfile) {
    super(`No Prowlarr download client is set up for a ${noun} grab`);
    this.name = 'GrabUnavailableError';
  }
}

/**
 * The Prowlarr download client for the media type, matched by exact name
 * against `PROWLARR_MOVIE_CLIENT` / `PROWLARR_TV_CLIENT`.
 */
async function resolveGrabClientId(
  api: ProwlarrAPI,
  profile: MediaProfile
): Promise<number | undefined> {
  const name = process.env[profile.grabClientEnv];
  return name ? api.findDownloadClientId(name) : undefined;
}

/**
 * Sends a Release straight to qBittorrent through Prowlarr (ADR-0002), for
 * items in Radarr/Sonarr only: anything else would always end in a Manual
 * Import.
 */
export async function grabRelease(
  mediaType: ManualSearchMediaType,
  tmdbId: number,
  release: GrabbableRelease
): Promise<GrabOutcome> {
  const config = getProwlarrConfig();
  if (!config) {
    throw new ManualSearchDisabledError();
  }
  const profile = PROFILES[mediaType];
  if (!(await isInArr(profile, tmdbId))) {
    throw new NotInArrError(profile);
  }
  const api = new ProwlarrAPI(config);
  const downloadClientId = await resolveGrabClientId(api, profile);
  if (downloadClientId == null) {
    throw new GrabUnavailableError(profile);
  }
  await api.grab({
    guid: release.guid,
    indexerId: release.indexerId,
    downloadClientId,
  });
  return { status: 'grabbed' };
}
