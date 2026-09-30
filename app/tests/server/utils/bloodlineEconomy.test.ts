// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { updateBloodline } from "@/server/api/routers/bloodline";

/**
 * Mock client for `updateBloodline`. The user passed in has `bloodlineId: null`, so the helper
 * skips the `client.query.jutsu.findMany` pre-read entirely (see the ternary at the top of the
 * function) - no need to stub the query builder for this path.
 */
const bloodlineClient = (userDataRowsAffected: number) => {
  const userDataWhere = vi.fn().mockResolvedValue({ rowsAffected: userDataRowsAffected });
  const userDataSet = vi.fn().mockReturnValue({ where: userDataWhere });
  const update = vi.fn().mockReturnValue({ set: userDataSet });
  const values = vi.fn().mockResolvedValue({ rowsAffected: 1 });
  const insert = vi.fn().mockReturnValue({ values });
  const client = { update, insert, transaction: async (run: (tx: unknown) => unknown) => run(client) };
  return { client: client as never, update, userDataSet, userDataWhere, insert, values };
};

const baseUser = {
  userId: "u1",
  bloodlineId: null,
  reputationPoints: 100,
  avatarLight: null,
  avatar: null,
} as never;

describe("updateBloodline", () => {
  it("throws when the CAS matches zero rows", async () => {
    const { client } = bloodlineClient(0);
    await expect(
      updateBloodline(client, baseUser, null, 50, "Bloodline Removed"),
    ).rejects.toThrow();
  });

  it("does not run the side-effect writes (actionLog) when the CAS fails", async () => {
    const { client, insert } = bloodlineClient(0);
    await expect(
      updateBloodline(client, baseUser, null, 50, "Bloodline Removed"),
    ).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });

  it("runs the actionLog side-effect write once the CAS succeeds", async () => {
    const { client, insert } = bloodlineClient(1);
    await updateBloodline(client, baseUser, null, 50, "Bloodline Removed");
    expect(insert).toHaveBeenCalledOnce();
  });
});

it("checks pending bloodline training only while holding the enqueue lock", async () => {
  const events: string[] = [];
  const pending = vi.fn(async () => { events.push("pending"); return { id: "queued" }; });
  const tx = {
    update: () => ({ set: () => ({ where: async () => { events.push("lock"); return { rowsAffected: 1 }; } }) }),
    query: { userJutsuTrainingQueue: { findFirst: pending } },
  };
  const client = {
    query: { jutsu: { findMany: async () => [{ id: "bloodline-jutsu" }] } },
    transaction: async (run: (tx: unknown) => unknown) => { events.push("transaction"); return run(tx); },
    insert: vi.fn(),
  };
  await expect(updateBloodline(client as never, { userId: "u1", bloodlineId: "old", reputationPoints: 100 } as never, null, 0, "Removed"))
    .rejects.toThrow("Cancel queued training");
  expect(events).toEqual(["transaction", "lock", "pending"]);
  expect(client.insert).not.toHaveBeenCalled();
});
