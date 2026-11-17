import { useUser } from "@clerk/nextjs";

/**
 * Whether data a server render produced for `renderedUserId` (null for a guest) belongs to
 * the account this tree runs as, so it may seed account-specific queries. Until clerk-js
 * loads, the tree runs under the cookie that rendered the page. After a session change
 * `ActiveSessionBoundary` remounts the page with the previous render's props, and those
 * seeds belong to another account, so the queries fetch instead.
 */
export const useRenderedForViewer = (renderedUserId: string | null) => {
  const { isLoaded, user } = useUser();
  return !isLoaded || (user?.id ?? null) === renderedUserId;
};
