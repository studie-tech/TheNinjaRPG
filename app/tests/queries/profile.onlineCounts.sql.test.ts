import { beforeEach, expect, it } from "bun:test";
import { ONLINE_WINDOW_MINUTES } from "@/drizzle/constants";
import { userData } from "@/drizzle/schema";
import {
  countUsersActiveInLastDay,
  selectUserDataForCountOnlineUsers,
} from "@/queries/profile";
import { secondsFromNow } from "@/utils/time";
import { insertUsers } from "../setup/factories";
import {
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../setup/testDatabase";

describeWithDatabase("online user counts", () => {
  beforeEach(async () => {
    await resetTables(userData);
    const minutesAgo = (minutes: number) => secondsFromNow(-minutes * 60);
    await insertUsers([
      { userId: "online-human", updatedAt: minutesAgo(1) },
      { userId: "online-ai", isAi: true, updatedAt: minutesAgo(2) },
      { userId: "day-human", updatedAt: minutesAgo(ONLINE_WINDOW_MINUTES + 5) },
      { userId: "day-ai", isAi: true, updatedAt: minutesAgo(60 * 20) },
      { userId: "stale-human", updatedAt: minutesAgo(60 * 25) },
      { userId: "stale-ai", isAi: true, updatedAt: minutesAgo(60 * 30) },
    ]);
  });

  it("counts every account, AI included, inside each window", async () => {
    const db = await getTestDatabase();
    const [[online], [daily]] = await Promise.all([
      selectUserDataForCountOnlineUsers(db),
      countUsersActiveInLastDay(db),
    ]);
    expect(online?.count).toBe(2);
    expect(daily?.count).toBe(4);
  });
});
