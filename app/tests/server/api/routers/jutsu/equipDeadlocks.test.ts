import { describe, expect, it } from "bun:test";
import { tryEquipUserJutsuAtomically } from "@/server/api/routers/jutsu";
import type { DrizzleClient } from "@/server/db";

describe("equipment deadlock recovery", () => {
  it.each([true, false])(
    "retries only the deadlocked statement (equipping=%s)",
    async (failedPhase) => {
      const writes: boolean[] = [];
      let failed = false;
      const client = {
        update: () => ({
          set: ({ equipped }: { equipped: boolean }) => ({
            where: async () => {
              writes.push(equipped);
              if (equipped === failedPhase && !failed) {
                failed = true;
                throw new Error("Failed query", {
                  cause: new Error(
                    "Deadlock found when trying to get lock; try restarting transaction",
                  ),
                });
              }
              return { rowsAffected: equipped ? 1 : 0 };
            },
          }),
        }),
      } as unknown as DrizzleClient;

      expect(
        await tryEquipUserJutsuAtomically({
          client,
          userId: "player",
          userJutsuId: "owned",
          maxEquip: 15,
          flags: {},
          caps: [],
        }),
      ).toBe("equipped");
      expect(writes).toEqual(failedPhase ? [true, true, false] : [true, false, false]);
    },
  );

  it("propagates failures that are not deadlocks without retrying", async () => {
    let writes = 0;
    const failure = new Error("Connection lost");
    const client = {
      update: () => ({
        set: () => ({
          where: async () => {
            writes += 1;
            throw failure;
          },
        }),
      }),
    } as unknown as DrizzleClient;
    await expect(
      tryEquipUserJutsuAtomically({
        client,
        userId: "player",
        userJutsuId: "owned",
        maxEquip: 15,
        flags: {},
        caps: [],
      }),
    ).rejects.toBe(failure);
    expect(writes).toBe(1);
  });
});
