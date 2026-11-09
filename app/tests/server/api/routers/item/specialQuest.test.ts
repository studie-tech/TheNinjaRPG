import { afterEach, describe, expect, it, vi } from "bun:test";
import { itemRouter } from "@/server/api/routers/item";
import type { DrizzleClient } from "@/server/db";
import { NonCombatConsumeRewardTag, NonCombatQuestTag } from "@/validators/combat";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { callerForDatabase } from "../../../../setup/testDatabase";

describe("Special quest consumption preflight", () => {
  afterEach(resetServerModuleStubs);

  it.each([
    { type: "special", active: true, message: "already on this quest" },
    { type: "mission", active: false, message: "existing Special quest" },
    { type: null, active: false, message: "existing Special quest" },
  ])(
    "rejects an active or invalid grant before effects: %j",
    async ({ type, active, message }) => {
      const owned = {
        id: "scroll-stack",
        userId: "hero",
        itemId: "scroll",
        quantity: 3,
        isInAuction: false,
        item: {
          itemType: "CONSUMABLE",
          preventBattleUsage: true,
          target: "SELF",
          method: "SINGLE",
          effects: [
            NonCombatQuestTag.parse({ questId: "special" }),
            NonCombatConsumeRewardTag.parse({ reward_money: 100 }),
          ],
        },
      };
      stubProfile("fetchUpdatedUser", (async () => ({
        user: { userId: "hero", status: "AWAKE", userQuests: [] },
      })) as never);
      const execute = vi.fn();
      const update = vi.fn();
      const insert = vi.fn();
      const transaction = vi.fn();
      const empty = () => ({ findMany: vi.fn().mockResolvedValue([]) });
      const client = {
        execute,
        update,
        insert,
        transaction,
        query: {
          actionLog: { findFirst: vi.fn().mockResolvedValue(undefined) },
          userItem: { findFirst: vi.fn().mockResolvedValue(owned) },
          bloodline: empty(),
          bloodlineRolls: empty(),
          sageModeRolls: empty(),
          sageMode: empty(),
          userSkill: empty(),
          quest: {
            findFirst: vi
              .fn()
              .mockResolvedValue(
                type
                  ? { id: "special", name: "Secret Contract", questType: type }
                  : undefined,
              ),
          },
          questHistory: {
            findFirst: vi
              .fn()
              .mockImplementation(async (options: { columns?: unknown }) =>
                options.columns
                  ? undefined
                  : active
                    ? { completed: 0, endAt: null }
                    : undefined,
              ),
          },
        },
      };
      const result = await callerForDatabase(
        itemRouter,
        "hero",
        client as unknown as DrizzleClient,
      ).consume({ userItemId: owned.id, requestId: "preflight-request" });
      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining(message),
      });
      expect(owned.quantity).toBe(3);
      expect(execute).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
