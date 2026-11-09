import { afterEach, describe, expect, it, vi } from "bun:test";
import { questsRouter } from "@/server/api/routers/quests";
import type { DrizzleClient } from "@/server/db";
import { resetServerModuleStubs, stubProfile } from "../../../../setup/serverModules";
import { callerForDatabase } from "../../../../setup/testDatabase";

describe("quest abandonment", () => {
  afterEach(resetServerModuleStubs);

  it.each(["story", "overworld", "special"] as const)(
    "allows a player to abandon an unfinished %s attempt",
    async (questType) => {
      const otherTracker = { id: "other-quest", goals: [] };
      stubProfile("fetchUpdatedUser", (async () => ({
        user: {
          userId: "hero",
          role: "USER",
          status: "AWAKE",
          userQuests: [
            {
              id: "attempt",
              questId: "contract",
              questType,
              completed: 0,
              endAt: null,
              quest: { questType, content: {} },
            },
          ],
          questData: [{ id: "contract", goals: [] }, otherTracker],
        },
      })) as never);
      const where = vi.fn().mockResolvedValue({ rowsAffected: 1 });
      const set = vi.fn((_value: Record<string, unknown>) => ({ where }));
      const update = vi.fn(() => ({ set }));
      const result = await callerForDatabase(questsRouter, "hero", {
        update,
      } as unknown as DrizzleClient).abandon({ id: "contract" });

      expect(result).toEqual({ success: true, message: "Quest abandoned" });
      expect(update).toHaveBeenCalledTimes(2);
      expect(set).toHaveBeenCalledWith({ completed: 0, endAt: expect.any(Date) });
      expect(set).toHaveBeenCalledWith(
        expect.objectContaining({
          questData: [otherTracker],
          questFinishAt: expect.any(Date),
        }),
      );
    },
  );

  it.each([
    ["USER", false],
    ["CONTENT", true],
  ] as const)(
    "applies the shared rule to %s abandoning an ANBU quest",
    async (role, allowed) => {
      stubProfile("fetchUpdatedUser", (async () => ({
        user: {
          userId: "hero",
          role,
          status: "AWAKE",
          userQuests: [
            {
              id: "attempt",
              questId: "contract",
              questType: "anbu",
              completed: 0,
              endAt: null,
              quest: { questType: "anbu", content: {} },
            },
          ],
          questData: [{ id: "contract", goals: [] }],
        },
      })) as never);
      const where = vi.fn().mockResolvedValue({ rowsAffected: 1 });
      const update = vi.fn(() => ({ set: () => ({ where }) }));
      const result = await callerForDatabase(questsRouter, "hero", {
        update,
      } as unknown as DrizzleClient).abandon({ id: "contract" });

      expect(result).toEqual(
        allowed
          ? { success: true, message: "Quest abandoned" }
          : { success: false, message: "Cannot abandon anbu quest type." },
      );
      expect(update).toHaveBeenCalledTimes(allowed ? 2 : 0);
    },
  );
});
