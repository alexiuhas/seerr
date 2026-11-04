import Alert from '@app/components/Common/Alert';
import Button from '@app/components/Common/Button';
import SlideOver from '@app/components/Common/SlideOver';
import ReleaseCard from '@app/components/ManualSearch/ReleaseCard';
import type { ReleaseSort } from '@app/components/ManualSearch/releases';
import { sortAndFilterReleases } from '@app/components/ManualSearch/releases';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type {
  ManualSearchErrorCode,
  ManualSearchErrorResponse,
  ManualSearchQueries,
  ManualSearchResponse,
  Release,
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
});

const SORTS: ReleaseSort[] = ['seeders', 'size', 'age'];

type SearchError = ManualSearchErrorCode | 'UNKNOWN';

interface ManualSearchPanelProps {
  show: boolean;
  onClose: () => void;
  mediaType: 'movie';
  tmdbId: number;
  title: string;
  queries: ManualSearchQueries;
}

const ManualSearchPanel = ({
  show,
  onClose,
  mediaType,
  tmdbId,
  title,
  queries,
}: ManualSearchPanelProps) => {
  const intl = useIntl();
  const [query, setQuery] = useState(queries.english);
  const [sort, setSort] = useState<ReleaseSort>('seeders');
  const [filter, setFilter] = useState('');
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SearchError | null>(null);
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
    try {
      const response = await axios.get<ManualSearchResponse>(
        '/api/v1/manualsearch',
        { params: { mediaType, tmdbId, query: trimmed } }
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

  const errorMessage = {
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
            type="search"
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

        <div className="flex flex-wrap items-center gap-2">
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
                className={`px-2.5 py-1 text-xs ${
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
              {intl.formatMessage(errorMessage[error])}
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
                visibleReleases.map((release) => (
                  <ReleaseCard
                    key={`${release.indexerId}-${release.guid}`}
                    release={release}
                  />
                ))
              )}
            </>
          ) : null}
        </div>
      </div>
    </SlideOver>
  );
};

export default ManualSearchPanel;
