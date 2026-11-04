import Button from '@app/components/Common/Button';
import Tooltip from '@app/components/Common/Tooltip';
import ManualSearchPanel from '@app/components/ManualSearch/ManualSearchPanel';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import type {
  ManualSearchMediaType,
  ManualSearchOptionsResponse,
} from '@server/interfaces/api/manualSearchInterfaces';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.ManualSearch', {
  manualsearch: 'Manual Search',
});

interface ManualSearchButtonProps {
  mediaType: ManualSearchMediaType;
  tmdbId: number;
  title: string;
}

/**
 * The Manual Search button for a detail page, with its panel. Renders nothing
 * unless the user is an admin and Prowlarr is configured.
 */
const ManualSearchButton = ({
  mediaType,
  tmdbId,
  title,
}: ManualSearchButtonProps) => {
  const intl = useIntl();
  const { hasPermission } = useUser();
  const [show, setShow] = useState(false);
  const isAdmin = hasPermission(Permission.ADMIN);

  const { data: options, mutate } = useSWR<ManualSearchOptionsResponse>(
    isAdmin
      ? `/api/v1/manualsearch/options?mediaType=${mediaType}&tmdbId=${tmdbId}`
      : null,
    { revalidateOnFocus: false }
  );

  if (!isAdmin || !options?.enabled || !options.queries) {
    return null;
  }

  return (
    <>
      <Tooltip content={intl.formatMessage(messages.manualsearch)}>
        <Button
          buttonType="ghost"
          onClick={() => {
            setShow(true);
            // a request made since the page loaded may have linked it to
            // Radarr/Sonarr
            mutate();
          }}
          className="ml-2 first:ml-0"
          aria-label={intl.formatMessage(messages.manualsearch)}
        >
          <MagnifyingGlassIcon className="!mr-0" />
        </Button>
      </Tooltip>
      {/* keyed so moving to another title starts a fresh search */}
      <ManualSearchPanel
        key={tmdbId}
        show={show}
        onClose={() => setShow(false)}
        mediaType={mediaType}
        tmdbId={tmdbId}
        title={title}
        queries={options.queries}
        scopes={options.scopes}
        inArr={!!options.inArr}
      />
    </>
  );
};

export default ManualSearchButton;
