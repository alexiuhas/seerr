import {
  getProwlarrConfig,
  IndexersUnavailableError,
  ProwlarrUnreachableError,
} from '@server/api/prowlarr';
import type {
  ManualSearchErrorCode,
  ManualSearchErrorResponse,
  ManualSearchOptionsResponse,
  ManualSearchResponse,
} from '@server/interfaces/api/manualSearchInterfaces';
import {
  getMovieQueries,
  ManualSearchDisabledError,
  searchMovieReleases,
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
  { tmdbId: string }
>('/options', async (req, res, next) => {
  if (!getProwlarrConfig()) {
    return res.status(200).json({ enabled: false });
  }
  try {
    const queries = await getMovieQueries(Number(req.query.tmdbId));
    return res.status(200).json({ enabled: true, queries });
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
  { query: string }
>('/', async (req, res, next) => {
  try {
    const results = await searchMovieReleases(req.query.query);
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

export default manualSearchRoutes;
