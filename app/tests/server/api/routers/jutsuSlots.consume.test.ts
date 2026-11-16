import { afterEach, describe, expect, it, vi } from "bun:test";
import { itemRouter } from "@/server/api/routers/item";
import type { DrizzleClient } from "@/server/db";
import { IncreaseJutsuSlots } from "@/validators/combat";
import { resetServerModuleStubs, stubProfile } from "../../../setup/serverModules";
import { callerForDatabase } from "../../../setup/testDatabase";

const consumption = (slots: number, power = 1, rowsAffected = 1) => {
  stubProfile("fetchUpdatedUser", (async () => ({
    user: {
      userId: "owner",
      status: "AWAKE",
      battleId: null,
      updatedAt: new Date(0),
      regenAt: new Date(),
      extraJutsuSlots: slots,
      extraReskinSlots: 0,
      marriageSlots: 1,
      curHealth: 100,
      curChakra: 100,
      curStamina: 100,
      bloodlineId: null,
      sageModeId: null,
    },
  })) as never);
  const execute = vi.fn(async () => ({ rowsAffected }));
  const empty = { findMany: async () => [] };
  const client = {
    execute,
    query: {
      userItem: {
        findFirst: async () => ({
          id: "scroll",
          userId: "owner",
          itemId: "slot-scroll",
          quantity: 3,
          isInAuction: false,
          craftingFinishedAt: null,
          item: {
            id: "slot-scroll",
            name: "Slot scroll",
            itemType: "CONSUMABLE",
            target: "SELF",
            method: "SINGLE",
            destroyOnUse: true,
            preventBattleUsage: true,
            effects: [{ ...IncreaseJutsuSlots.parse({}), power }],
          },
        }),
      },
      bloodline: empty,
      bloodlineRolls: empty,
      sageMode: empty,
      sageModeRolls: empty,
      userSkill: empty,
    },
  } as unknown as DrizzleClient;
  return { caller: callerForDatabase(itemRouter, "owner", client), execute };
};

describe("jutsu slot consumption rejections", () => {
  afterEach(resetServerModuleStubs);

  it("reports the shared cap before consuming an item when two slots are already owned", async () => {
    const { caller, execute } = consumption(2);
    expect(await caller.consume({ userItemId: "scroll" })).toMatchObject({
      success: false,
      message: expect.stringContaining("maximum of 2 extra jutsu slots"),
    });
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects an oversized or malformed grant before any write", async () => {
    for (const [slots, power] of [
      [1, 2],
      [0, 0],
      [0, 1.5],
      [0, 3],
    ]) {
      const { caller, execute } = consumption(slots!, power!);
      expect((await caller.consume({ userItemId: "scroll" })).success).toBe(false);
      expect(execute).not.toHaveBeenCalled();
    }
  });
  it("returns a recoverable failure when the guarded debit loses a race", async () => {
    const { caller, execute } = consumption(1, 1, 0);
    expect(await caller.consume({ userItemId: "scroll" })).toMatchObject({
      success: false,
      message: expect.stringContaining("Your item was not consumed"),
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it("confirms the slot reward only after an acknowledged atomic debit", async () => {
    const { caller, execute } = consumption(1);
    expect(await caller.consume({ userItemId: "scroll" })).toMatchObject({
      success: true,
      notifications: ["You gained 1 extra jutsu slot!"],
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
