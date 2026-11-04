/**
 * Shared `userData` projections for relational queries, keeping the fields behind avatars
 * and user links identical across features.
 */

/** Identity shown on a user link or avatar. */
export const userSummaryColumns = {
  userId: true,
  username: true,
  avatar: true,
  level: true,
  rank: true,
} as const;

/** Summary plus the light avatar variant. */
export const userSummaryWithLightColumns = {
  ...userSummaryColumns,
  avatarLight: true,
} as const;

/** Summary plus the role and standing shown on public user cards. */
export const userCardColumns = {
  ...userSummaryColumns,
  isOutlaw: true,
  role: true,
  federalStatus: true,
} as const;
