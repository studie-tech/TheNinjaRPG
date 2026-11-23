/**
 * The queries built with cdnCachedProcedure, keyed as the client's `op.path`. The shell
 * layout hands them to TrpcClientProvider, which sends them to /api/trpc/cdn, and that
 * endpoint answers for them alone. The list is spelled out so the layout does not load
 * the router to read it; tests/server/api/cdnCachedQueries.test.ts checks it against the
 * router's procedure metadata.
 */
export const CDN_CACHED_QUERY_PATHS: readonly string[] = [
  "chakraStorm.getLeaderboard",
  "kessen.getCatalog",
  "profile.getStrongestUsers",
  "towerDefense.getLeaderboard",
  "towerDefense.getRoster",
  "travel.getStoryCast",
];
