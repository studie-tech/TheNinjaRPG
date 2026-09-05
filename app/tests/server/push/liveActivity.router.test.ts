// @vitest-environment node

import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { userData, userLiveActivity } from "@/drizzle/schema";
import { pushRouter } from "@/server/api/routers/push";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

const USER_ID = "live-activity-user";
const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);

describeWithDatabase("Live Activities across a player's devices", () => {
  beforeEach(async () => {
    await resetTables(userLiveActivity, userData);
    await insertUsers([{ userId: USER_ID, username: "liveactivity" }]);
  });

  it("keeps same-kind activities separate and ends only the addressed device", async () => {
    const api = await callerFor(pushRouter, USER_ID);
    const endsAt = new Date(Date.now() + 60_000);
    await api.registerActivity({
      activityId: "activity-a",
      kind: "hospital",
      pushToken: TOKEN_A,
      endsAt,
    });
    await api.registerActivity({
      activityId: "activity-b",
      kind: "hospital",
      pushToken: TOKEN_B,
      endsAt,
    });

    const database = await getTestDatabase();
    expect(await database.select().from(userLiveActivity)).toHaveLength(2);

    await api.endActivity({ activityId: "activity-a" });
    const remaining = await database
      .select()
      .from(userLiveActivity)
      .where(eq(userLiveActivity.userId, USER_ID));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.activityId).toBe("activity-b");
  });
});
