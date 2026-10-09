// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeEach, expect, it } from "vitest";
import { actionLog, userData, userRequest, village } from "@/drizzle/schema";
import { kageRouter } from "@/server/api/routers/kage";
import { insertUsers } from "../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../setup/testDatabase";

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
    const caller = await callerFor(kageRouter, "cache-kage");
    const result = await caller.toggleOpenForChallenges({ villageId: "cache-village" });
    const db = await getTestDatabase();
    const stored = await db.query.village.findFirst({
      where: eq(village.id, "cache-village"),
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      id: stored?.id,
      openForChallenges: true,
      openForChallengesAt: stored?.openForChallengesAt,
    });
    const retry = await caller.toggleOpenForChallenges({ villageId: "cache-village" });
    expect(retry.success).toBe(false);
    expect(retry.data).toBeUndefined();
  });

  it("does not expose a patch or change availability for a non-kage", async () => {
    const caller = await callerFor(kageRouter, "cache-member");
    const result = await caller.toggleOpenForChallenges({ villageId: "cache-village" });
    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    const stored = await (await getTestDatabase()).query.village.findFirst({
      where: eq(village.id, "cache-village"),
    });
    expect(stored?.openForChallenges).toBe(false);
  });
});
