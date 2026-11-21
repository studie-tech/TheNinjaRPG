import { selectOpenEventParticipantIds } from "@/queries/tournament";
import type { DrizzleClient } from "@/server/db";
import { createRuntimeCache } from "@/server/utils/caches/runtimeCache";

// Every seated player of an open event, withdrawn seats included, so players outside it
// skip the notice read. Saves that seat a player invalidate it; the TTL bounds a missed
// invalidation. Closed events and withdrawn seats only cost the notice read a no-op.
const eventNoticeParticipants = createRuntimeCache({
  name: "event-notice-participants",
  ttlSeconds: 60,
  cloneReads: false,
  load: async (client: Pick<DrizzleClient, "select">) => {
    const rows = await selectOpenEventParticipantIds(client);
    return [...new Set(rows.flatMap((row) => row.userIds ?? []))];
  },
});

/** User ids seated in an open event. Callers share the list and must not mutate it. */
export const fetchEventNoticeParticipants = eventNoticeParticipants.read;

/** Make every instance list open-event participants again; await after seating players. */
export const invalidateEventNoticeParticipants = eventNoticeParticipants.invalidate;
