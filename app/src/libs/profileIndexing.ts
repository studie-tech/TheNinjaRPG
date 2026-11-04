import { and, eq, gte, isNull } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import { addDays } from "@/utils/time";

/**
 * Which player profiles are worth a search engine's attention.
 *
 * The sitemap and the profile routes must agree on this, so both read it from here:
 * a profile the sitemap declines to advertise must also answer `noindex`, or it stays
 * indexed on the strength of an old crawl. That is how a level-13 account inactive
 * since March became the site's most-clicked page -- its username happens to match a
 * high-volume query unrelated to the game -- and half of all measured search clicks
 * turned out to be visitors who were never going to play.
 */

export const PROFILE_INDEX_MIN_LEVEL = 25;
export const PROFILE_INDEX_ACTIVE_DAYS = 90;

/** Oldest `updatedAt` a profile may carry and still be indexable. */
export const profileIndexCutoff = (now = Date.now()) =>
  addDays(new Date(now), -PROFILE_INDEX_ACTIVE_DAYS);

export interface ProfileIndexFields {
  level: number;
  updatedAt: Date | null;
  isAi: boolean;
  isBanned: boolean;
  deletionAt: Date | null;
}

/**
 * isProfileIndexable
 * - The in-memory form of `profileIndexableWhere` below; keep the two in step.
 * @param user - The profile's level, activity and status fields
 * @param now - Injectable for tests
 */
export const isProfileIndexable = (user: ProfileIndexFields, now = Date.now()) =>
  user.level >= PROFILE_INDEX_MIN_LEVEL &&
  user.updatedAt !== null &&
  user.updatedAt.getTime() >= profileIndexCutoff(now).getTime() &&
  !user.isAi &&
  !user.isBanned &&
  user.deletionAt === null;

/** The SQL form of `isProfileIndexable`, for the sitemap's profile list. */
export const profileIndexableWhere = () =>
  and(
    gte(userData.level, PROFILE_INDEX_MIN_LEVEL),
    gte(userData.updatedAt, profileIndexCutoff()),
    eq(userData.isAi, false),
    eq(userData.isBanned, false),
    isNull(userData.deletionAt),
  );
