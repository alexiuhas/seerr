import defineMessages from '@app/utils/defineMessages';
import { formatBytes } from '@app/utils/numberHelpers';
import type { Release } from '@server/interfaces/api/manualSearchInterfaces';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.ManualSearch.ReleaseCard', {
  ageDays: '{days}d',
  ageMonths: '{months}mo',
  ageYears: '{years}y',
  seedersLeechers: 'Seeders / leechers',
  age: 'Age',
});

interface ReleaseCardProps {
  release: Release;
}

const ReleaseCard = ({ release }: ReleaseCardProps) => {
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

  return (
    <article className="rounded-md bg-gray-900/50 p-3 ring-1 ring-gray-700">
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
      </div>
    </article>
  );
};

export default ReleaseCard;
