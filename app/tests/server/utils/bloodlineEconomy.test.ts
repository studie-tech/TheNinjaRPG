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
  return { client: { update, insert } as never, update, userDataSet, userDataWhere, insert, values };
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
