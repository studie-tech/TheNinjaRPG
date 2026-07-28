import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ drizzleDB: {} }));
vi.mock("@/libs/pusher", () => ({
  broadcastRaidAvailability: vi.fn(),
  updateUserOnMap: vi.fn(),
}));

import { saveUsage } from "@/libs/combat/database";
import type { CombatResult, CompleteBattle } from "@/libs/combat/types";
import type { DrizzleClient } from "@/server/db";

describe("saveUsage", () => {
  it("normalizes an absent bloodline key before the aggregate upsert", async () => {
    const onDuplicateKeyUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onDuplicateKeyUpdate });
    const client = {
      insert: vi.fn().mockReturnValue({ values }),
    } as unknown as DrizzleClient;
    const battle = {
      battleType: "ARENA",
      usersState: [
        {
          userId: "human",
          bloodlineId: "bloodline-1",
          usedActions: [{ id: "jutsu-1", type: "jutsu" }],
          isAi: false,
          isSummon: false,
        },
        {
          userId: "ai-user",
          controllerId: "ai-1",
          usedActions: [],
          isAi: true,
          isSummon: false,
        },
      ],
    } as unknown as CompleteBattle;
    const result = { outcome: "Won" } as CombatResult;

    await saveUsage(client, battle, result, "human");

    expect(values).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "jutsu",
        contentId: "jutsu-1",
        relatedBloodlineId: "bloodline-1",
      }),
      expect.objectContaining({
        type: "bloodline",
        contentId: "bloodline-1",
        relatedBloodlineId: "",
      }),
      expect.objectContaining({
        type: "ai",
        contentId: "ai-1",
        relatedBloodlineId: "",
      }),
    ]);
    expect(onDuplicateKeyUpdate).toHaveBeenCalledOnce();
  });
});
