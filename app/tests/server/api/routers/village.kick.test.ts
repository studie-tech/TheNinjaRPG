import { describe, expect, it } from "bun:test";
import type { UserData } from "@/drizzle/schema";
import { villageRouter } from "@/server/api/routers/village";
import type { DrizzleClient } from "@/server/db";
import { callerForDatabase } from "../../../setup/testDatabase";

/** Rejected expulsions must stop before the guarded write or any membership cleanup. */
const rejectionClient = (
  target: Partial<UserData> = {},
  kageId = "kage",
  actor: Partial<UserData> = {},
) => {
  let reads = 0;
  let writes = 0;
  const db = {
    query: {
      userData: {
        findFirst: async () =>
          reads++ === 0
            ? { userId: "kage", villageId: "home", ...actor }
            : { userId: "member", villageId: "home", tutorialOn: false, ...target },
      },
      village: { findFirst: async () => ({ id: "home", type: "VILLAGE", kageId }) },
    },
    execute: async () => {
      writes++;
      return { rowsAffected: 0 };
    },
  };
  return {
    caller: callerForDatabase(villageRouter, "kage", db as unknown as DrizzleClient),
    writes: () => writes,
    reads: () => reads,
  };
};

describe("Kage expulsion admission", () => {
  it("requires a nonblank, sufficiently detailed reason before reading or writing", async () => {
    for (const reason of ["", "   ", "too short"]) {
      const client = rejectionClient();
      await expect(
        client.caller.kickMember({ userId: "member", reason }),
      ).rejects.toThrow();
      expect(client.reads()).toBe(0);
      expect(client.writes()).toBe(0);
    }
  });

  it("rejects non-Kage actors, self-expulsion, foreign members, active tutorials and cooldowns", async () => {
    const clients = [
      rejectionClient({}, "someone-else"),
      rejectionClient({ userId: "kage" }),
      rejectionClient({ villageId: "other" }),
      rejectionClient({ tutorialOn: true, tutorialStep: 0 }),
      rejectionClient({}, "kage", { lastKageKickAt: new Date() }),
      rejectionClient({ status: "BATTLE" }),
      rejectionClient({ status: "QUEUED" }),
    ];
    for (const client of clients) {
      expect(
        (
          await client.caller.kickMember({
            userId: "member",
            reason: "Repeated harassment of village members",
          })
        ).success,
      ).toBe(false);
      expect(client.writes()).toBe(0);
    }
  });

  it("reports a lost atomic guard without logging or cleaning up membership", async () => {
    const client = rejectionClient();
    const result = await client.caller.kickMember({
      userId: "member",
      reason: "Repeated harassment of village members",
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain("changed");
    expect(client.writes()).toBe(1);
  });
});
