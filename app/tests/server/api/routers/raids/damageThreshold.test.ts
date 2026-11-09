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
    stubRateLimitTransport({
      unexpectedRequestMessage: "Unexpected HTTP request in raid threshold tests",
    });
  });
  afterEach(() => {
    resetServerModuleStubs();
    vi.restoreAllMocks();
  });

  it("rejects coordinate-targeted effects on create", async () => {
    const { caller, database } = makeCaller();
    await expect(
      caller.createDamageThreshold({
        questId: "raid-quest",
        damageRequired: 100,
        rewards,
        effects: [coordinateEffect],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(database.insert).not.toHaveBeenCalled();
    expect(
      await caller.createDamageThreshold({
        questId: "raid-quest",
        damageRequired: 100,
        rewards,
        effects: [IncreaseStatTag.parse({})],
      }),
    ).toMatchObject({ success: true });
  });

  it("rejects coordinate-targeted effects on update", async () => {
    const { caller, database } = makeCaller();
    await expect(
      caller.updateDamageThreshold({
        thresholdId: "threshold",
        damageRequired: 100,
        sortOrder: 0,
        rewards,
        effects: [coordinateEffect],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(database.update).not.toHaveBeenCalled();
  });
});
