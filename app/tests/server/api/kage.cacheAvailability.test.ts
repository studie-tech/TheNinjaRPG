import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "bun:test";
import { actionLog, userData, userRequest, village } from "@/drizzle/schema";
import { kageRouter } from "@/server/api/routers/kage";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

import { beforeStatements } from "../../setup/statements";
import { countUserReads } from "../../setup/userReads";

describeWithDatabase("kage challenge availability cache response", () => {
  beforeEach(async () => {
    await resetTables(actionLog, userData, userRequest, village);
    const db = await getTestDatabase();
    await db.insert(village).values({
      id: "cache-village",
      name: "Cache village",
      sector: 30,
      kageId: "cache-kage",
      type: "VILLAGE",
      openForChallenges: false,
    });
    await insertUsers([
      { userId: "cache-kage", villageId: "cache-village", rank: "JONIN" },
      { userId: "cache-member", villageId: "cache-village", rank: "JONIN" },
    ]);
  });

  it("returns the committed availability and timestamp, with no patch on a rejected retry", async () => {
    const db = await getTestDatabase();
    const counted = countUserReads(db);
    const caller = callerForDatabase(kageRouter, "cache-kage", counted.client);
    const result = await caller.toggleOpenForChallenges({ villageId: "cache-village" });
    expect(counted.getVillageReads()).toBe(1);
    const stored = await db.query.village.findFirst({
      where: eq(village.id, "cache-village"),
    });
    expect(result.success).toBe(true);
    expect(result.userPatch?.village).toEqual<{ id: string | undefined; openForChallenges: boolean; openForChallengesAt: Date | undefined }>({
      id: stored?.id,
      openForChallenges: true,
      openForChallengesAt: stored?.openForChallengesAt,
    });
    const retry = await caller.toggleOpenForChallenges({ villageId: "cache-village" });
    expect(retry.success).toBe(false);
    expect(retry.userPatch).toBeUndefined();
  });

  it("rejects an intervening availability change without a success log or patch", async () => {
    const db = await getTestDatabase();
    const client = beforeStatements(db, village, [async () => {
      await db.update(village).set({ openForChallenges: true })
        .where(eq(village.id, "cache-village"));
    }]);
    const result = await callerForDatabase(kageRouter, "cache-kage", client)
      .toggleOpenForChallenges({ villageId: "cache-village" });
    expect(result.success).toBe(false);
    expect(result.userPatch).toBeUndefined();
    expect(await db.query.actionLog.findMany()).toHaveLength(0);
  });

  it("does not expose a patch or change availability for a non-kage", async () => {
    const caller = await callerFor(kageRouter, "cache-member");
    const result = await caller.toggleOpenForChallenges({ villageId: "cache-village" });
    expect(result.success).toBe(false);
    expect(result.userPatch).toBeUndefined();
    const stored = await (await getTestDatabase()).query.village.findFirst({
      where: eq(village.id, "cache-village"),
    });
    expect(stored?.openForChallenges).toBe(false);
  });
});
