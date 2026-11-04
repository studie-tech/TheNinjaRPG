/**
 * Columns behind a user's poster or author card. `maskStaffReportCommentAuthors`
 * overwrites each of them to hide staff, so a new column needs a mask value there too.
 */
export const userCardColumns = {
  userId: true,
  username: true,
  avatar: true,
  rank: true,
  isOutlaw: true,
  level: true,
  role: true,
  federalStatus: true,
} as const;
