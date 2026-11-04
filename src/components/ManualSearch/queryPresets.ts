import type {
  ManualSearchQueries,
  SearchScope,
} from '@server/interfaces/api/manualSearchInterfaces';

/** A one-tap search query offered as a chip under the query box. */
export type QueryPreset =
  | { kind: 'english' | 'original' | 'series'; query: string }
  | { kind: 'season'; season: number; query: string };

/**
 * The chips offered under the query box: a movie's English and Original
 * titles, or a series and each of its seasons. No chips when there's only one
 * choice, since the query box already holds it.
 */
export const queryPresets = (
  queries: ManualSearchQueries,
  scopes?: SearchScope[]
): QueryPreset[] => {
  const presets: QueryPreset[] = scopes
    ? scopes.map((scope) =>
        scope.season == null
          ? { kind: 'series', query: scope.query }
          : { kind: 'season', season: scope.season, query: scope.query }
      )
    : [
        { kind: 'english', query: queries.english },
        ...(queries.original
          ? [{ kind: 'original' as const, query: queries.original }]
          : []),
      ];
  return presets.length > 1 ? presets : [];
};
