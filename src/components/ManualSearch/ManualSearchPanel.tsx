import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import SlideOver from '@app/components/Common/SlideOver';
import ReleaseCard from '@app/components/ManualSearch/ReleaseCard';
import type {
  CardState,
  ReleaseSort,
} from '@app/components/ManualSearch/releases';
import {
  releaseKey,
  sortAndFilterReleases,
} from '@app/components/ManualSearch/releases';
import { encodeURIExtraParams } from '@app/hooks/useDiscover';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type {
  ArrName,
  GrabOutcome,
  GrabRequestBody,
  ManualSearchErrorCode,
  ManualSearchErrorResponse,
  ManualSearchMediaType,
  ManualSearchQueries,
  ManualSearchResponse,
  PushOutcome,
  PushRequestBody,
  Release,
  SearchScope,
} from '@server/interfaces/api/manualSearchInterfaces';
import axios from 'axios';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ManualSearch', {
  manualsearch: 'Manual Search',
  searchquery: 'Search Query',
  searchprowlarr: 'Search Prowlarr',
  search: 'Search',
  englishtitle: 'English',
  originaltitle: 'Original',
  sortby: 'Sort By',
  sortseeders: 'Seeders',
  sortsize: 'Size',
  sortage: 'Age',
  filterreleases: 'Filter releases…',
  releasecount: '{count, plural, one {# release} other {# releases}}',
  noresults: 'No releases found. Try another query.',
  nomatches: 'No releases match the filter.',
  errortitle: 'Search failed',
  indexersunavailable:
    'All Prowlarr indexers are unavailable. Check their status in Prowlarr, then search again.',
  prowlarrunreachable:
    'Prowlarr could not be reached. Check that it is running and that PROWLARR_URL and PROWLARR_API_KEY are correct.',
  disabled: 'Prowlarr is not configured.',
  unknownerror: 'Something went wrong while searching. Please try again.',
  searchscope: 'Search Scope',
  wholeseries: 'Whole series',
  season: 'Season {seasonNumber}',
  notinarr: 'Not in {arr} yet. Request it using the Quiet Server, then push.',
  senttoarr: 'Sent to {arr}.',
  queuedinarr: 'Queued in {arr} (pending).',
  pushnotinarr: 'The movie is not in {arr} yet.',
  pushseriesnotinarr: 'The series is not in {arr} yet.',
  pushnoserver:
    'No {arr} server is configured for this movie. Set a default {arr} server in Settings.',
  pushseriesnoserver:
    'No {arr} server is configured for this series. Set a default {arr} server in Settings.',
  pushunreachable:
    '{arr} could not be reached. Check that it is running, then push again.',
  pushfailed: 'Something went wrong while pushing to {arr}.',
  sentviaprowlarr: 'Sent via Prowlarr.',
  searchexpired:
    "Prowlarr's search results have expired, so the Release can no longer be grabbed. Search again, then grab it.",
  searchagain: 'Search Again',
  grabunavailable:
    'No Prowlarr download client is set up for this. Check PROWLARR_MOVIE_CLIENT / PROWLARR_TV_CLIENT.',
  grabfailed: 'Prowlarr could not grab the Release.',
  grabunreachable:
    'Prowlarr could not be reached. Check that it is running, then grab again.',
});

const IDLE: CardState = { status: 'idle' };

const SORTS: ReleaseSort[] = ['seeders', 'size', 'age'];

type SearchError = ManualSearchErrorCode | 'UNKNOWN';

interface ManualSearchPanelProps {
  show: boolean;
  onClose: () => void;
  mediaType: ManualSearchMediaType;
  tmdbId: number;
  title: string;
  queries: ManualSearchQueries;
  /** TV only: the whole series first, then each regular season. */
  scopes?: SearchScope[];
  /** Whether the item is linked to a Radarr movie / Sonarr series. */
  inArr: boolean;
  /** Whether a rejected Push can fall back to a Prowlarr Grab. */
  prowlarrGrabAvailable: boolean;
}

const ManualSearchPanel = ({
  show,
  onClose,
  mediaType,
  tmdbId,
  title,
  queries,
  scopes,
  inArr,
  prowlarrGrabAvailable,
}: ManualSearchPanelProps) => {
  const intl = useIntl();
  const arr: ArrName = mediaType === 'tv' ? 'Sonarr' : 'Radarr';
  const isTv = mediaType === 'tv';
  const { addToast } = useToasts();
  // Kept across searches, so a Release already Pushed can't be Pushed twice.
  const [cards, setCards] = useState<Record<string, CardState>>({});
  const [query, setQuery] = useState(queries.english);
  // 0 is the whole series
  const [scopeIndex, setScopeIndex] = useState(0);
  const [sort, setSort] = useState<ReleaseSort>('seeders');
  const [filter, setFilter] = useState('');
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SearchError | null>(null);
  // A grab found Prowlarr's search cache expired: the results need refreshing.
  const [searchExpired, setSearchExpired] = useState(false);
  // ignores responses from searches that a newer one has superseded
  const latestSearch = useRef(0);

  const search = async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      return;
    }
    const searchId = ++latestSearch.current;
    setLoading(true);
    setError(null);
    setSearchExpired(false);
    try {
      // Encoded by hand: axios turns spaces into '+', which the OpenAPI
      // validator rejects as a reserved character.
      const response = await axios.get<ManualSearchResponse>(
        `/api/v1/manualsearch?mediaType=${mediaType}&tmdbId=${tmdbId}&query=${encodeURIExtraParams(
          trimmed
        )}`
      );
      if (searchId === latestSearch.current) {
        setReleases(response.data.results);
      }
    } catch (e) {
      if (searchId === latestSearch.current) {
        const code = axios.isAxiosError<ManualSearchErrorResponse>(e)
          ? e.response?.data?.code
          : undefined;
        setReleases(null);
        setError(code ?? 'UNKNOWN');
      }
    } finally {
      if (searchId === latestSearch.current) {
        setLoading(false);
      }
    }
  };

  const pushErrorMessage: Partial<
    Record<ManualSearchErrorCode, typeof messages.pushfailed>
  > = {
    NOT_IN_ARR: isTv ? messages.pushseriesnotinarr : messages.pushnotinarr,
    ARR_NOT_CONFIGURED: isTv
      ? messages.pushseriesnoserver
      : messages.pushnoserver,
    ARR_UNREACHABLE: messages.pushunreachable,
  };

  const setCard = (key: string, state: CardState) =>
    setCards((prev) => ({ ...prev, [key]: state }));

  const push = async (release: Release) => {
    const key = releaseKey(release);
    setCard(key, { status: 'pushing' });
    try {
      // The server picks out the fields Radarr/Sonarr need.
      const body: PushRequestBody = { mediaType, tmdbId, release };
      const { data: outcome } = await axios.post<PushOutcome>(
        '/api/v1/manualsearch/push',
        body
      );
      setCard(key, outcome);
      if (outcome.status === 'approved') {
        addToast(intl.formatMessage(messages.senttoarr, { arr }), {
          appearance: 'success',
          autoDismiss: true,
        });
      } else if (outcome.status === 'pending') {
        addToast(intl.formatMessage(messages.queuedinarr, { arr }), {
          appearance: 'info',
          autoDismiss: true,
        });
      }
    } catch (e) {
      setCard(key, IDLE);
      const code = axios.isAxiosError<ManualSearchErrorResponse>(e)
        ? e.response?.data?.code
        : undefined;
      addToast(
        intl.formatMessage(
          (code && pushErrorMessage[code]) ?? messages.pushfailed,
          { arr }
        ),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    }
  };

  const grabErrorMessage: Partial<
    Record<ManualSearchErrorCode, typeof messages.grabfailed>
  > = {
    NOT_IN_ARR: isTv ? messages.pushseriesnotinarr : messages.pushnotinarr,
    GRAB_UNAVAILABLE: messages.grabunavailable,
    PROWLARR_UNREACHABLE: messages.grabunreachable,
  };

  const grab = async (release: Release, rejections: string[]) => {
    const key = releaseKey(release);
    setCard(key, { status: 'prowlarrGrabbing', rejections });
    try {
      const body: GrabRequestBody = {
        mediaType,
        tmdbId,
        release: { guid: release.guid, indexerId: release.indexerId },
      };
      await axios.post<GrabOutcome>('/api/v1/manualsearch/grab', body);
      setCard(key, { status: 'prowlarrGrabbed' });
      addToast(intl.formatMessage(messages.sentviaprowlarr), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch (e) {
      setCard(key, { status: 'rejected', rejections });
      const code = axios.isAxiosError<ManualSearchErrorResponse>(e)
        ? e.response?.data?.code
        : undefined;
      if (code === 'SEARCH_EXPIRED') {
        setSearchExpired(true);
        return;
      }
      addToast(
        intl.formatMessage(
          (code && grabErrorMessage[code]) ?? messages.grabfailed,
          { arr }
        ),
        {
          appearance: 'error',
          autoDismiss: true,
        }
      );
    }
  };

  // Search with the prefilled query the first time the panel opens.
  useEffect(() => {
    if (show && releases === null && !loading && !error) {
      search(query);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const visibleReleases = useMemo(
    () => (releases ? sortAndFilterReleases(releases, sort, filter) : []),
    [releases, sort, filter]
  );

  const titleChips = [
    {
      label: intl.formatMessage(messages.englishtitle),
      query: queries.english,
    },
    ...(queries.original
      ? [
          {
            label: intl.formatMessage(messages.originaltitle),
            query: queries.original,
          },
        ]
      : []),
  ];

  const errorMessage: Partial<
    Record<SearchError, typeof messages.unknownerror>
  > = {
    INDEXERS_UNAVAILABLE: messages.indexersunavailable,
    PROWLARR_UNREACHABLE: messages.prowlarrunreachable,
    DISABLED: messages.disabled,
    UNKNOWN: messages.unknownerror,
  };

  const sortLabel = {
    seeders: messages.sortseeders,
    size: messages.sortsize,
    age: messages.sortage,
  };

  return (
    <SlideOver
      show={show}
      title={intl.formatMessage(messages.manualsearch)}
      subText={title}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3">
        {!inArr && (
          <Alert type="info">
            {intl.formatMessage(messages.notinarr, { arr })}
          </Alert>
        )}
        {searchExpired && (
          <Alert type="warning">
            <div className="flex flex-col items-start gap-2">
              <span>{intl.formatMessage(messages.searchexpired)}</span>
              <Button
                buttonType="warning"
                buttonSize="sm"
                disabled={loading}
                onClick={() => search(query)}
              >
                <MagnifyingGlassIcon />
                <span>{intl.formatMessage(messages.searchagain)}</span>
              </Button>
            </div>
          </Alert>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            search(query);
          }}
        >
          <label htmlFor="manual-search-query" className="sr-only">
            {intl.formatMessage(messages.searchquery)}
          </label>
          <input
            id="manual-search-query"
            type="text"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={intl.formatMessage(messages.searchprowlarr)}
            className="min-w-0 flex-1"
          />
          <Button
            type="submit"
            buttonType="primary"
            disabled={loading || !query.trim()}
          >
            <MagnifyingGlassIcon />
            <span className="hidden sm:inline">
              {intl.formatMessage(messages.search)}
            </span>
          </Button>
        </form>

        {isTv && scopes && scopes.length > 0 && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="manual-search-scope"
              className="text-xs uppercase tracking-wide text-gray-400"
            >
              {intl.formatMessage(messages.searchscope)}
            </label>
            <select
              id="manual-search-scope"
              value={scopeIndex}
              onChange={(e) => {
                const index = Number(e.target.value);
                setScopeIndex(index);
                setQuery(scopes[index].query);
                search(scopes[index].query);
              }}
              className="w-auto"
            >
              {scopes.map((option, index) => (
                <option key={option.season ?? 'series'} value={index}>
                  {option.season == null
                    ? intl.formatMessage(messages.wholeseries)
                    : intl.formatMessage(messages.season, {
                        seasonNumber: option.season,
                      })}
                </option>
              ))}
            </select>
          </div>
        )}

        {titleChips.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {titleChips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => {
                  setQuery(chip.query);
                  search(chip.query);
                }}
                className={`rounded-full border px-3 py-1 text-xs ${
                  query === chip.query
                    ? 'border-indigo-500 bg-indigo-600/30 text-white'
                    : 'border-gray-600 text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span className="text-gray-400">{chip.label}:</span>{' '}
                {chip.query}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-stretch gap-2">
          <div
            role="group"
            aria-label={intl.formatMessage(messages.sortby)}
            className="inline-flex overflow-hidden rounded-md border border-gray-600"
          >
            {SORTS.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={sort === key}
                onClick={() => setSort(key)}
                className={`flex items-center px-2.5 py-1 text-xs ${
                  sort === key
                    ? 'bg-gray-600 text-white'
                    : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                {intl.formatMessage(sortLabel[key])}
              </button>
            ))}
          </div>
          <label htmlFor="manual-search-filter" className="sr-only">
            {intl.formatMessage(messages.filterreleases)}
          </label>
          <input
            id="manual-search-filter"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={intl.formatMessage(messages.filterreleases)}
            className="min-w-0 flex-1"
          />
        </div>

        <div className="flex flex-col gap-3" aria-live="polite">
          {loading ? (
            Array.from({ length: 4 }, (_, i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-md bg-gray-700/50"
              />
            ))
          ) : error ? (
            <Alert type="error" title={intl.formatMessage(messages.errortitle)}>
              {intl.formatMessage(errorMessage[error] ?? messages.unknownerror)}
            </Alert>
          ) : releases ? (
            <>
              <div className="text-xs tabular-nums text-gray-400">
                {intl.formatMessage(messages.releasecount, {
                  count: visibleReleases.length,
                })}
              </div>
              {releases.length === 0 ? (
                <p className="text-sm text-gray-400">
                  {intl.formatMessage(messages.noresults)}
                </p>
              ) : visibleReleases.length === 0 ? (
                <p className="text-sm text-gray-400">
                  {intl.formatMessage(messages.nomatches)}
                </p>
              ) : (
                visibleReleases.map((release) => {
                  const key = releaseKey(release);
                  const state = cards[key] ?? IDLE;
                  return (
                    <ReleaseCard
                      key={key}
                      release={release}
                      state={state}
                      arr={arr}
                      canPush={inArr}
                      onPush={() => push(release)}
                      canGrab={inArr && prowlarrGrabAvailable}
                      onGrab={() =>
                        grab(
                          release,
                          'rejections' in state ? state.rejections : []
                        )
                      }
                    />
                  );
                })
              )}
            </>
          ) : null}
        </div>
      </div>
    </SlideOver>
  );
};

export default ManualSearchPanel;
