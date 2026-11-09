import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { REMOVAL_COST } from "@/drizzle/constants";
import { actionLog, userData, userQueue } from "@/drizzle/schema";
import { sageModeRouter } from "@/server/api/routers/sageMode";
import { insertUsers } from "../../../setup/factories";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import {
  callerFor,
  callerForDatabase,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";
import { beforeStatements } from "../../../setup/statements";
import { queueEnergy } from "../../../setup/queues";

const userId = "sage-cache-player";
const snapshot = {
  userId,
  status: "AWAKE",
  sageModeId: "sage-cache-mode",
  reputationPoints: REMOVAL_COST + 20,
};

describe("sage removal cache response", () => {
  beforeEach(() => stubProfile("fetchAllGameSettings", async () => []));
  afterEach(() => resetServerModuleStubs());
  for (const pendingQueue of [false, true]) {
    it(`returns a confirmed charge without a post-read, pending queue=${pendingQueue}`, async () => {
      const read = vi.fn().mockResolvedValue({
        ...snapshot,
        energyQueueHead: 0,
        energyQueueTail: pendingQueue ? 1 : 0,
      });
      const db = {
        query: { userData: { findFirst: read } },
        update: () => ({ set: () => ({ where: async () => ({ rowsAffected: 1 }) }) }),
        insert: () => ({ values: async () => ({ rowsAffected: 1 }) }),
      };
      const result = await callerForDatabase(
        sageModeRouter,
        userId,
        db as never,
      ).removeSageMode();
      expect(result.success).toBe(true);
      expect(result.userDelta).toEqual(
        pendingQueue ? undefined : { reputationPoints: -REMOVAL_COST },
      );
      expect(read).toHaveBeenCalledTimes(1);
    });
  }
  it("does not grant a success response or log after a rejected CAS", async () => {
    const db = {
      query: { userData: { findFirst: async () => snapshot } },
      update: () => ({ set: () => ({ where: async () => ({ rowsAffected: 0 }) }) }),
      insert: vi.fn(),
    };
    expect(
      await callerForDatabase(sageModeRouter, userId, db as never).removeSageMode(),
    ).toMatchObject({ success: false, message: "Unable to update sage mode" });
    expect(db.insert).not.toHaveBeenCalled();
  });
  it("does not charge a player who has no sage mode", async () => {
    const db = {
      query: {
        userData: { findFirst: async () => ({ ...snapshot, sageModeId: null }) },
      },
      update: vi.fn(),
      insert: vi.fn(),
    };
    expect(
      await callerForDatabase(sageModeRouter, userId, db as never).removeSageMode(),
    ).toMatchObject({ success: false, message: "You do not have a sage mode" });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describeWithDatabase("sage removal committed balances", () => {
  beforeEach(async () => {
    await resetTables(userQueue, actionLog, userData);
    await insertUsers([{ ...snapshot, status: "AWAKE" }]);
  });
  afterEach(() => resetServerModuleStubs());
  it("clears the mode and charges exactly the response cost while retaining an independent grant", async () => {
    const db = await getTestDatabase();
    const raced = beforeStatements(db, userData, [
      async () => {
        await db
          .update(userData)
          .set({ reputationPoints: sql`${userData.reputationPoints} + 7` })
          .where(eq(userData.userId, userId));
      },
    ]);
    const result = await callerForDatabase(
      sageModeRouter,
      userId,
      raced,
    ).removeSageMode();
    const stored = await db.query.userData.findFirst({
      where: eq(userData.userId, userId),
    });
    expect(result.userDelta).toEqual({ reputationPoints: -REMOVAL_COST });
    expect(stored?.reputationPoints).toBe(27);
    expect(stored?.sageModeId).toBeNull();
  });
  it("keeps full reconciliation for a server-side pending queue", async () => {
    await queueEnergy(userId, [{ stat: "offence", energy: 10 }]);
    const result = await (await callerFor(sageModeRouter, userId)).removeSageMode();
    expect(result.success).toBe(true);
    expect(result.userDelta).toBeUndefined();
  });
});
