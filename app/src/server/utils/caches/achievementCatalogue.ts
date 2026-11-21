import { selectAchievementCatalogue } from "@/queries/quests";
import { createRuntimeCache } from "@/server/utils/caches/runtimeCache";

// Achievements change only when staff edit quests, which invalidate the cache. Rows stay
// complete because they become the `quest` of each player's achievement entries. Each
// caller receives a clone, so per-user rewrites such as hidden quest locations operate on
// private copies.
const achievementCatalogue = createRuntimeCache({
  name: "achievement-catalogue",
  ttlSeconds: 60 * 60,
  load: selectAchievementCatalogue,
});

/** Visible achievements from the Runtime Cache. */
export const fetchAchievementCatalogue = achievementCatalogue.read;

/** Make every instance read achievements again; await after quest definition writes. */
export const invalidateAchievementCatalogue = achievementCatalogue.invalidate;
