import Tooltip from '@app/components/Common/Tooltip';
import type { CardState } from '@app/components/ManualSearch/releases';
import defineMessages from '@app/utils/defineMessages';
import { formatBytes } from '@app/utils/numberHelpers';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import type { Release } from '@server/interfaces/api/manualSearchInterfaces';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ManualSearch.ReleaseCard', {
  ageDays: '{days}d',
  ageMonths: '{months}mo',
  ageYears: '{years}y',
  seedersLeechers: 'Seeders / leechers',
  age: 'Age',
  push: 'Push to Radarr',
  pushing: 'Pushing to Radarr…',
  grabbed: 'Grabbed by Radarr',
  pending: 'Pending in Radarr',
  rejected: 'Rejected',
  radarrsaid: 'Radarr said:',
});

interface ReleaseCardProps {
  release: Release;
  state: CardState;
  /**
   * False when the movie isn't in Radarr, so Radarr has nothing to match.
   * The panel explains why.
   */
  canPush: boolean;
  onPush: () => void;
}

const Spinner = () => (
  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle
      cx="12"
      cy="12"
      r="9"
      stroke="currentColor"
      strokeOpacity=".25"
      strokeWidth="3"
    />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" />
  </svg>
);

const ReleaseCard = ({ release, state, canPush, onPush }: ReleaseCardProps) => {
  const intl = useIntl();

  const age =
    release.ageDays < 60
      ? intl.formatMessage(messages.ageDays, { days: release.ageDays })
      : release.ageDays < 730
        ? intl.formatMessage(messages.ageMonths, {
            months: Math.round(release.ageDays / 30),
          })
        : intl.formatMessage(messages.ageYears, {
            years: intl.formatNumber(release.ageDays / 365, {
              maximumFractionDigits: 1,
            }),
          });

  const pill = {
    approved: ['bg-green-600', messages.grabbed],
    pending: ['bg-yellow-600', messages.pending],
    rejected: ['bg-red-600', messages.rejected],
  } as const;
  const statusPill =
    state.status in pill ? pill[state.status as keyof typeof pill] : null;

  const pushLabel = intl.formatMessage(messages.push);

  return (
    <article
      className={`rounded-md bg-gray-900/50 p-3 ring-1 ${
        state.status === 'approved' ? 'ring-green-700' : 'ring-gray-700'
      }`}
    >
      <div className="break-words font-mono text-xs leading-5 text-gray-100 [overflow-wrap:anywhere]">
        {release.infoUrl ? (
          <a
            href={release.infoUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:underline"
          >
            {release.title}
          </a>
        ) : (
          release.title
        )}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-gray-400">
          <span className="rounded bg-gray-700 px-1.5 py-0.5 text-gray-200">
            {release.indexer}
          </span>
          <span>{formatBytes(release.size, 1)}</span>
          <span title={intl.formatMessage(messages.seedersLeechers)}>
            <span className="text-green-400">{release.seeders}</span>
            {' / '}
            <span className="text-red-400">{release.leechers}</span>
          </span>
          <span title={intl.formatMessage(messages.age)}>{age}</span>
          {release.categories[0] && <span>{release.categories[0]}</span>}
        </div>
        {state.status === 'pushing' ? (
          <span
            role="status"
            aria-label={intl.formatMessage(messages.pushing)}
            className="inline-flex shrink-0 items-center rounded-md bg-indigo-600/60 px-3 py-1.5 text-white"
          >
            <Spinner />
          </span>
        ) : state.status === 'idle' ? (
          <Tooltip content={pushLabel}>
            <button
              type="button"
              onClick={onPush}
              disabled={!canPush}
              aria-label={pushLabel}
              className="inline-flex shrink-0 items-center rounded-md bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-indigo-600"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
            </button>
          </Tooltip>
        ) : null}
      </div>
      {statusPill && (
        <div className="mt-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold text-white ${statusPill[0]}`}
          >
            {intl.formatMessage(statusPill[1])}
          </span>
        </div>
      )}
      {state.status === 'rejected' && state.rejections.length > 0 && (
        <div className="mt-3 rounded-md border border-red-700/60 bg-red-950/40 p-3 text-xs">
          <div className="mb-1 font-semibold text-red-300">
            {intl.formatMessage(messages.radarrsaid)}
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-red-200">
            {state.rejections.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
};

export default ReleaseCard;
