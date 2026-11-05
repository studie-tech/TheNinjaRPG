import type { UserData } from "@/drizzle/schema";

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

/**
 * Summary plus the role and standing shown on public user cards.
 * `maskStaffReportCommentAuthors` overwrites each of these to hide staff, so a new column
 * needs a mask value there too.
 */
export const userCardColumns = {
  ...userSummaryColumns,
  isOutlaw: true,
  role: true,
  federalStatus: true,
} as const;

/** A user selected through `userCardColumns`, for code rendering or masking such a card. */
export type UserCard = Pick<UserData, keyof typeof userCardColumns>;
