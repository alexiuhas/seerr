import {
  getProwlarrConfig,
  GrabFailedError,
  IndexersUnavailableError,
  ProwlarrUnreachableError,
  SearchExpiredError,
} from '@server/api/prowlarr';
import { ArrUnreachableError } from '@server/api/releasePush';
import type {
  GrabOutcome,
  GrabRequestBody,
  ManualSearchErrorCode,
  ManualSearchErrorResponse,
  ManualSearchMediaType,
  ManualSearchOptionsResponse,
  ManualSearchResponse,
  PushOutcome,
  PushRequestBody,
} from '@server/interfaces/api/manualSearchInterfaces';
import {
  ArrNotConfiguredError,
  getManualSearchOptions,
  grabRelease,
  GrabUnavailableError,
  ManualSearchDisabledError,
  NotInArrError,
  pushRelease,
  searchReleases,
} from '@server/lib/manualSearch';
import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import type { Response } from 'express';
import { Router } from 'express';

const manualSearchRoutes = Router();

// Every Manual Search route is admin-only, whatever it is mounted under.
manualSearchRoutes.use(isAuthenticated(Permission.ADMIN));

const sendError = (
  res: Response,
  status: number,
  code: ManualSearchErrorCode,
  message: string
) => res.status(status).json({ code, message } as ManualSearchErrorResponse);

manualSearchRoutes.get<
  never,
  ManualSearchOptionsResponse,
  never,
  { mediaType: ManualSearchMediaType; tmdbId: string }
>('/options', async (req, res, next) => {
  if (!getProwlarrConfig()) {
    return res.status(200).json({ enabled: false });
  }
  try {
    const options = await getManualSearchOptions(
      req.query.mediaType,
      Number(req.query.tmdbId)
    );
    return res.status(200).json(options);
  } catch (e) {
    logger.error('Manual Search could not build the search queries', {
      label: 'Manual Search',
      errorMessage: e.message,
    });
    return next({ status: 500, message: e.message });
  }
});

manualSearchRoutes.get<
  never,
  ManualSearchResponse | ManualSearchErrorResponse,
  never,
  { mediaType: ManualSearchMediaType; query: string }
>('/', async (req, res, next) => {
  try {
    const results = await searchReleases(req.query.mediaType, req.query.query);
    return res.status(200).json({ results });
  } catch (e) {
    if (e instanceof ManualSearchDisabledError) {
      return sendError(res, 503, 'DISABLED', e.message);
    }
    if (e instanceof IndexersUnavailableError) {
      return sendError(res, 502, 'INDEXERS_UNAVAILABLE', e.message);
    }
    if (e instanceof ProwlarrUnreachableError) {
      logger.error('Manual Search could not reach Prowlarr', {
        label: 'Manual Search',
        errorMessage: e.message,
      });
      return sendError(res, 502, 'PROWLARR_UNREACHABLE', e.message);
    }
    return next({ status: 500, message: e.message });
  }
});

manualSearchRoutes.post<
  never,
  PushOutcome | ManualSearchErrorResponse,
  PushRequestBody
>('/push', async (req, res, next) => {
  try {
    const outcome = await pushRelease(
      req.body.mediaType,
      Number(req.body.tmdbId),
      req.body.release
    );
    return res.status(200).json(outcome);
  } catch (e) {
    if (e instanceof NotInArrError) {
      return sendError(res, 409, 'NOT_IN_ARR', e.message);
    }
    if (e instanceof ArrNotConfiguredError) {
      return sendError(res, 409, 'ARR_NOT_CONFIGURED', e.message);
    }
    if (e instanceof ArrUnreachableError) {
      logger.error('Manual Search could not push the Release', {
        label: 'Manual Search',
        errorMessage: e.message,
      });
      return sendError(res, 502, 'ARR_UNREACHABLE', e.message);
    }
    return next({ status: 500, message: e.message });
  }
});

manualSearchRoutes.post<
  never,
  GrabOutcome | ManualSearchErrorResponse,
  GrabRequestBody
>('/grab', async (req, res, next) => {
  try {
    const outcome = await grabRelease(
      req.body.mediaType,
      Number(req.body.tmdbId),
      req.body.release
    );
    return res.status(200).json(outcome);
  } catch (e) {
    if (e instanceof ManualSearchDisabledError) {
      return sendError(res, 503, 'DISABLED', e.message);
    }
    if (e instanceof NotInArrError) {
      return sendError(res, 409, 'NOT_IN_ARR', e.message);
    }
    if (e instanceof GrabUnavailableError) {
      return sendError(res, 409, 'GRAB_UNAVAILABLE', e.message);
    }
    if (e instanceof SearchExpiredError) {
      return sendError(res, 410, 'SEARCH_EXPIRED', e.message);
    }
    if (e instanceof GrabFailedError || e instanceof ProwlarrUnreachableError) {
      logger.error('Manual Search could not grab the Release', {
        label: 'Manual Search',
        errorMessage: e.message,
      });
      return sendError(
        res,
        502,
        e instanceof GrabFailedError ? 'GRAB_FAILED' : 'PROWLARR_UNREACHABLE',
        e.message
      );
    }
    return next({ status: 500, message: e.message });
  }
});

export default manualSearchRoutes;
