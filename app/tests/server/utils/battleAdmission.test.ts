import { describe, expect, it } from "bun:test";
import type { DrizzleClient } from "@/server/db";
import { commitBattleAdmission } from "@/server/utils/battleAdmission";

/** Runs the callback directly and counts how often a transaction was opened. */
const fakeClient = (failFirst?: Error) => {
  const state = { attempts: 0 };
  const client = {
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      state.attempts += 1;
      if (failFirst && state.attempts === 1) throw failFirst;
      return run({});
    },
  } as unknown as DrizzleClient;
  return { client, state };
};

const claimFailedMessage = "Claim failed";

describe("commitBattleAdmission", () => {
  it("returns the created battle when admission and claim succeed", async () => {
    const { client } = fakeClient();
    const steps: string[] = [];
    const committed = await commitBattleAdmission({
      client,
      admit: async () => {
        steps.push("admit");
      },
      createBattle: async () => {
        steps.push("create");
        return "battle";
      },
      didClaim: () => true,
      claimFailedMessage,
    });
    expect(committed).toEqual({ success: true, result: "battle" });
    expect(steps).toEqual(["admit", "create"]);
  });

  it("rolls back with the admission's own message before creating the battle", async () => {
    const { client } = fakeClient();
    let created = false;
    const committed = await commitBattleAdmission({
      client,
      admit: async (_tx, reject) => reject("Receipt changed"),
      createBattle: async () => {
        created = true;
      },
      didClaim: () => true,
      claimFailedMessage,
    });
    expect(committed).toEqual({ success: false, message: "Receipt changed" });
    expect(created).toBe(false);
  });

  it("rolls back with the claim message on a partial claim", async () => {
    const { client } = fakeClient();
    const committed = await commitBattleAdmission({
      client,
      createBattle: async () => "battle",
      didClaim: () => false,
      claimFailedMessage,
    });
    expect(committed).toEqual({ success: false, message: claimFailedMessage });
  });

  it("restarts the whole transaction on a deadlock", async () => {
    const { client, state } = fakeClient(new Error("Deadlock found"));
    const committed = await commitBattleAdmission({
      client,
      createBattle: async () => "battle",
      didClaim: () => true,
      claimFailedMessage,
    });
    expect(committed).toEqual({ success: true, result: "battle" });
    expect(state.attempts).toBe(2);
  });

  it("propagates unexpected errors", async () => {
    const { client } = fakeClient(new Error("Connection lost"));
    await expect(
      commitBattleAdmission({
        client,
        createBattle: async () => "battle",
        didClaim: () => true,
        claimFailedMessage,
      }),
    ).rejects.toThrow("Connection lost");
  });
});
