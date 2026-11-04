import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import SlideOver from '@app/components/Common/SlideOver';
import ReleaseCard from '@app/components/ManualSearch/ReleaseCard';
import { useHorizontalWheelScroll } from '@app/components/ManualSearch/horizontalWheel';
import type { QueryPreset } from '@app/components/ManualSearch/queryPresets';
import { queryPresets } from '@app/components/ManualSearch/queryPresets';
import type {
  CardState,
  ReleaseSort,
  ReleaseSortKey,
  SortDirection,
} from '@app/components/ManualSearch/releases';
import {
  DEFAULT_SORT,
  nextSort,
  releaseKey,
  sortAndFilterReleases,
} from '@app/components/ManualSearch/releases';
import useDebouncedState from '@app/hooks/useDebouncedState';
import { encodeURIExtraParams } from '@app/hooks/useDiscover';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import {
  AdjustmentsHorizontalIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  MagnifyingGlassIcon as SearchFieldIcon,
} from '@heroicons/react/20/solid';
import {
  ArrowPathIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
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
import type { InputHTMLAttributes } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ManualSearch', {
  manualsearch: 'Manual Search',
  searchquery: 'Search Query',
  searchprowlarr: 'Search Prowlarr',
  searchfor: 'Search For',
  englishtitle: 'English',
  originaltitle: 'Original',
  seriespreset: 'Series',
  seasonpreset: 'S{seasonNumber}',
  sortby: 'Sort By',
  sortseeders: 'Seeders',
  sortsize: 'Size',
  sortage: 'Age',
  sortseedersdesc: 'Most seeders first',
  sortseedersasc: 'Fewest seeders first',
  sortsizeasc: 'Smallest first',
  sortsizedesc: 'Largest first',
  sortageasc: 'Newest first',
  sortagedesc: 'Oldest first',
  filterreleases: 'Filter releases…',
  clearfilter: 'Clear filter',
  resetquery: 'Reset search',
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

// Seerr's main search input (Layout/SearchInput), a size smaller.
const INPUT_CLASS =
  'block w-full rounded-full border border-gray-600 bg-gray-900/80 py-1.5 pl-9 text-sm leading-5 text-white placeholder-gray-300 hover:border-gray-500 focus:border-gray-500 focus:bg-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-0';

/** An icon button inside the right end of an IconInput. */
interface InputAction {
  icon: typeof XCircleIcon;
  label: string;
  onClick: () => void;
}

/**
 * A pill-shaped input with its icon inside on the left, and optionally an
 * action button inside on the right.
 */
const IconInput = ({
  icon: Icon,
  action,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  icon: typeof SearchFieldIcon;
  action?: InputAction;
}) => (
  <div className="relative text-white focus-within:text-gray-200">
    <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
      <Icon className="h-4 w-4" />
    </div>
    <input
      type="search"
      autoComplete="off"
      className={`${INPUT_CLASS} ${action ? 'pr-9' : 'pr-3'}`}
      {...props}
    />
    {action && (
      <button
        type="button"
        onClick={action.onClick}
        aria-label={action.label}
        title={action.label}
        className="absolute inset-y-0 right-2 m-auto h-6 w-6 rounded-full p-1 text-gray-400 transition hover:text-white"
      >
        <action.icon className="h-4 w-4" />
      </button>
    )}
  </div>
);

const SORTS: ReleaseSortKey[] = ['seeders', 'size', 'age'];

// The arrow follows the sorted value: down is largest first.
const SORT_ICON: Record<SortDirection, typeof ArrowDownIcon> = {
  asc: ArrowUpIcon,
  desc: ArrowDownIcon,
};

const SORT_ORDER_LABEL: Record<
  ReleaseSortKey,
  Record<SortDirection, typeof messages.sortseedersdesc>
> = {
  seeders: { desc: messages.sortseedersdesc, asc: messages.sortseedersasc },
  size: { asc: messages.sortsizeasc, desc: messages.sortsizedesc },
  age: { asc: messages.sortageasc, desc: messages.sortagedesc },
};

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
  // Searches as you type, after a pause, like Seerr's main search. The pause
  // is longer than its 300ms, since each search hits every indexer.
  const [query, debouncedQuery, setQuery] = useDebouncedState(
    queries.english,
    600
  );
  const [sort, setSort] = useState<ReleaseSort>(DEFAULT_SORT);
  const [filter, setFilter] = useState('');
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SearchError | null>(null);
  // A grab found Prowlarr's search cache expired: the results need refreshing.
  const [searchExpired, setSearchExpired] = useState(false);
  // ignores responses from searches that a newer one has superseded
  const latestSearch = useRef(0);
  // the last query sent, so the debounced query doesn't send it again
  const lastSearched = useRef('');

  const search = async (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      return;
    }
    const searchId = ++latestSearch.current;
    lastSearched.current = trimmed;
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

  // Search once typing pauses, starting with the prefilled query when the
  // panel first opens. Chips and Enter search straight away.
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (show && trimmed && trimmed !== lastSearched.current) {
      search(trimmed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, debouncedQuery]);

  const visibleReleases = useMemo(
    () => (releases ? sortAndFilterReleases(releases, sort, filter) : []),
    [releases, sort, filter]
  );

  const presets = queryPresets(queries, scopes);
  // a long season list scrolls sideways with the mouse wheel
  const chipRowRef = useHorizontalWheelScroll();
  const presetLabel = (preset: QueryPreset) => {
    switch (preset.kind) {
      case 'english':
        return intl.formatMessage(messages.englishtitle);
      case 'original':
        return intl.formatMessage(messages.originaltitle);
      case 'series':
        return intl.formatMessage(messages.seriespreset);
      case 'season':
        return intl.formatMessage(messages.seasonpreset, {
          seasonNumber: String(preset.season).padStart(2, '0'),
        });
    }
  };

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
          <p className="flex items-start gap-1.5 text-xs text-gray-400">
            <InformationCircleIcon className="h-4 w-4 shrink-0" />
            <span>{intl.formatMessage(messages.notinarr, { arr })}</span>
          </p>
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
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            search(query);
          }}
        >
          <label htmlFor="manual-search-query" className="sr-only">
            {intl.formatMessage(messages.searchquery)}
          </label>
          <IconInput
            icon={SearchFieldIcon}
            id="manual-search-query"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={intl.formatMessage(messages.searchprowlarr)}
            action={{
              icon: ArrowPathIcon,
              label: intl.formatMessage(messages.resetquery),
              // back to the prefilled query, searched again
              onClick: () => {
                setQuery(queries.english);
                search(queries.english);
              },
            }}
          />
        </form>

        {presets.length > 0 && (
          <div
            ref={chipRowRef}
            role="group"
            aria-label={intl.formatMessage(messages.searchfor)}
            className="hide-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4"
          >
            {presets.map((preset) => (
              <button
                key={preset.query}
                type="button"
                title={preset.query}
                aria-pressed={query === preset.query}
                onClick={() => {
                  setQuery(preset.query);
                  search(preset.query);
                }}
                className={`shrink-0 rounded-full border px-3 py-1 text-xs ${
                  query === preset.query
                    ? 'border-indigo-500 bg-indigo-600/30 text-white'
                    : 'border-gray-500 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {presetLabel(preset)}
              </button>
            ))}
          </div>
        )}

        <div
          className="mt-1 flex flex-col gap-3 border-t border-gray-700 pt-4"
          aria-live="polite"
        >
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
              {releases.length > 0 && (
                <>
                  <div className="flex items-center gap-3">
                    <span className="shrink-0 text-xs tabular-nums text-gray-400">
                      {intl.formatMessage(messages.releasecount, {
                        count: visibleReleases.length,
                      })}
                    </span>
                    <span
                      aria-hidden="true"
                      className="h-px flex-1 bg-gray-600"
                    />
                    <div
                      role="group"
                      aria-label={intl.formatMessage(messages.sortby)}
                      className="flex shrink-0 items-center gap-0.5"
                    >
                      {SORTS.map((key) => {
                        const active = sort.key === key;
                        // active: the current order; others: the order a tap starts in
                        const shown = active ? sort : nextSort(sort, key);
                        const Icon = SORT_ICON[sort.direction];
                        return (
                          <button
                            key={key}
                            type="button"
                            aria-pressed={active}
                            title={intl.formatMessage(
                              SORT_ORDER_LABEL[key][shown.direction]
                            )}
                            onClick={() => setSort(nextSort(sort, key))}
                            className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs ${
                              active
                                ? 'font-semibold text-white'
                                : 'text-gray-400 hover:text-gray-200'
                            }`}
                          >
                            {intl.formatMessage(sortLabel[key])}
                            {active && (
                              <Icon
                                aria-hidden="true"
                                className="h-3 w-3 text-indigo-300"
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="manual-search-filter" className="sr-only">
                      {intl.formatMessage(messages.filterreleases)}
                    </label>
                    <IconInput
                      icon={AdjustmentsHorizontalIcon}
                      id="manual-search-filter"
                      enterKeyHint="done"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder={intl.formatMessage(messages.filterreleases)}
                      action={
                        filter
                          ? {
                              icon: XCircleIcon,
                              label: intl.formatMessage(messages.clearfilter),
                              onClick: () => setFilter(''),
                            }
                          : undefined
                      }
                    />
                  </div>
                </>
              )}
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
