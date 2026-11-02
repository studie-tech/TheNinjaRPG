import { getServerPusher } from "@/libs/pusher";

/** Signal committed count changes without exposing queue identities or ordering concurrent counters. */
export const notifyRankedQueueChanged = async (rowsAffected: number) => {
  if (rowsAffected === 0) return;
  try {
    await getServerPusher().trigger("ranked-queue", "updated", {});
  } catch (error) {
    // Queue writes remain successful during socket outages; foreground polling
    // and subscription recovery reconcile observers against the database.
    console.warn("Ranked queue notification failed", error);
  }
};
