import { countActivePlayersByVillage } from "@/queries/village";
import type { DrizzleClient } from "@/server/db";
import { createRuntimeCache } from "@/server/utils/caches/runtimeCache";
import { secondsFromNow, WEEK_S } from "@/utils/time";

/** The window the village chooser reports activity for. */
const ACTIVITY_WINDOW_SECONDS = WEEK_S;

// The village chooser marks the joinable village with the fewest players active this
// week. Counting them scans every human UserData row (lastActiveAt is not indexed), while
// the result is a handful of { villageId, players } rows, one 8 KB Runtime Cache unit per
// read. A week-long count moves by a fraction of a percent per hour, so an hour of
// staleness is invisible on the chooser, and nothing needs to invalidate it.
const villageActivity = createRuntimeCache({
  name: "village-activity",
  ttlSeconds: 60 * 60,
  cloneReads: false,
  load: (client: Pick<DrizzleClient, "select">) =>
    countActivePlayersByVillage(client, secondsFromNow(-ACTIVITY_WINDOW_SECONDS)),
});

/** Human players active in the last week per village, from the Runtime Cache. */
export const fetchVillageActivity = (client: Pick<DrizzleClient, "select">) =>
  villageActivity.read(client);

/** Make every instance count village activity again. */
export const invalidateVillageActivity = villageActivity.invalidate;
