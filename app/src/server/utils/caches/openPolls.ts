import { selectOpenPolls } from "@/queries/poll";
import type { DrizzleClient } from "@/server/db";
import { createRuntimeCache } from "@/server/utils/caches/runtimeCache";

// Every profile read asks whether the player has an open poll to vote on, while polls open
// and close only through the poll router's create, update and close mutations, which
// invalidate the listing. A poll's end date is compared with the current time on every
// read. Instances check the shared version once a minute, so a newly opened poll can reach
// players served by another instance up to a minute late.
const openPolls = createRuntimeCache({
  name: "open-polls",
  ttlSeconds: 10 * 60,
  memorySeconds: 60,
  cloneReads: false,
  load: selectOpenPolls,
});

/** Whether any active poll is still open at `now`, from the Runtime Cache. */
export const hasOpenPoll = async (client: Pick<DrizzleClient, "select">, now: Date) =>
  (await openPolls.read(client)).some((entry) => !entry.endDate || entry.endDate > now);

/** Make every instance list open polls again; await after writes that open or close one. */
export const invalidateOpenPolls = openPolls.invalidate;
