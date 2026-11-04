import ExternalAPI from '@server/api/externalapi';
import type { PushOutcome } from '@server/interfaces/api/manualSearchInterfaces';
import axios from 'axios';

/** What Radarr's `/api/v3/release/push` takes for a torrent Release. */
export interface ReleasePushBody {
  title: string;
  protocol: 'torrent';
  publishDate: string;
  downloadUrl: string;
  guid?: string;
  size?: number;
  indexer?: string;
  infoUrl?: string;
  seeders?: number;
  leechers?: number;
  tmdbId?: number;
  imdbId?: string;
}

interface ReleaseResource {
  approved?: boolean;
  temporarilyRejected?: boolean;
  rejected?: boolean;
  rejections?: (string | { reason?: string })[];
}

interface ValidationFailure {
  errorMessage?: string;
}

/** Radarr couldn't be reached, or failed in an unexpected way. */
export class ArrUnreachableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ArrUnreachableError';
  }
}

const reasons = (rejections: ReleaseResource['rejections'] = []) =>
  rejections
    .map((rejection) =>
      typeof rejection === 'string' ? rejection : rejection.reason
    )
    .filter((reason): reason is string => !!reason);

/**
 * Pushes Releases to a Radarr instance. It has no cache store, unlike
 * RadarrAPI, and posts through axios directly: a push must always reach
 * Radarr, never be answered from a cached response.
 */
class ReleasePushAPI extends ExternalAPI {
  constructor({ url, apiKey }: { url: string; apiKey: string }) {
    super(url, {}, { headers: { 'X-Api-Key': apiKey } });
  }

  public async push(body: ReleasePushBody): Promise<PushOutcome> {
    let data: ReleaseResource | ReleaseResource[];
    try {
      const response = await this.axios.post<
        ReleaseResource | ReleaseResource[]
      >('/release/push', body);
      data = response.data;
    } catch (e) {
      // 400 is Radarr refusing the Release itself, e.g. "Unable to parse".
      if (axios.isAxiosError(e) && e.response?.status === 400) {
        const failures: ValidationFailure[] = Array.isArray(e.response.data)
          ? e.response.data
          : [e.response.data ?? {}];
        const messages = failures
          .map((failure) => failure.errorMessage)
          .filter((message): message is string => !!message);
        return {
          status: 'rejected',
          rejections: messages.length ? messages : ['Unable to parse'],
        };
      }
      throw new ArrUnreachableError(`[Radarr] Push failed: ${e.message}`, {
        cause: e,
      });
    }

    // Radarr v4+ answers with a list; older versions with the release itself.
    const decision = Array.isArray(data) ? data[0] : data;
    if (!decision) {
      throw new ArrUnreachableError('[Radarr] Push returned no decision');
    }
    if (decision.approved) {
      return { status: 'approved' };
    }
    if (decision.temporarilyRejected) {
      return { status: 'pending', rejections: reasons(decision.rejections) };
    }
    return { status: 'rejected', rejections: reasons(decision.rejections) };
  }
}

export default ReleasePushAPI;
