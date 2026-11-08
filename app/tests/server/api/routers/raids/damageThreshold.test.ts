import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { raidsRouter } from "@/server/api/routers/raids";
import { IncreaseStatTag } from "@/validators/combat";
import { ObjectiveReward } from "@/validators/rewards";
import { stubRateLimitTransport } from "../../../../setup/rateLimit";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { callerForDatabase } from "../../../../setup/testDatabase";

/** Threshold effects become passive user buffs at battle start, so they carry no tile. */
const coordinateEffect = IncreaseStatTag.parse({ target: "COORDINATES" });
const rewards = ObjectiveReward.parse({});

const makeCaller = () => {
  const values = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const where = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const database = {
    query: { quest: { findFirst: vi.fn().mockResolvedValue({ id: "raid-quest" }) } },
    insert: vi.fn(() => ({ values })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
  };
  return {
    caller: callerForDatabase(raidsRouter, "threshold-editor", database as never),
    database,
  };
};

describe("raid damage threshold effects", () => {
  beforeEach(() => {
    stubProfile("fetchUser", async () => ({ role: "OWNER" }));
    stubRateLimitTransport({ unexpectedRequestMessage: "Unexpected HTTP request in raid threshold tests" });
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it("stores coordinate-targeted effects on create", async () => {
    const { caller, database } = makeCaller();
    const result = await caller.createDamageThreshold({
      questId: "raid-quest",
      damageRequired: 100,
      rewards,
      effects: [coordinateEffect],
    });
    expect(result).toMatchObject({ success: true });
    expect(database.insert).toHaveBeenCalledTimes(1);
  });

  it("stores coordinate-targeted effects on update", async () => {
    const { caller, database } = makeCaller();
    const result = await caller.updateDamageThreshold({
      thresholdId: "threshold",
      damageRequired: 100,
      sortOrder: 0,
      rewards,
      effects: [coordinateEffect],
    });
    expect(result).toMatchObject({ success: true });
    expect(database.update).toHaveBeenCalledTimes(1);
  });
});
