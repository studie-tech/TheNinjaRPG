// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  adjustSeichiSilverAtomically,
  removeBloodlineFromPoolAtomically,
} from "@/server/utils/concurrency";

const silverClient = (rowsAffected: number) => {
  const where = vi.fn().mockResolvedValue({ rowsAffected });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { client: { update } as never, update, set, where };
};

describe("adjustSeichiSilverAtomically", () => {
  it("succeeds on a positive delta (no floor predicate)", async () => {
    const { client, update } = silverClient(1);
    const ok = await adjustSeichiSilverAtomically({
      client,
      userId: "u1",
      delta: 100,
    });
    expect(update).toHaveBeenCalledOnce();
    expect(ok).toBe(true);
  });

  it("fails when a subtraction is blocked by the balance floor (0 rows)", async () => {
    const { client } = silverClient(0);
    const ok = await adjustSeichiSilverAtomically({
      client,
      userId: "u1",
      delta: -100,
    });
    expect(ok).toBe(false);
  });
});

const poolClient = (deleteRows: number, updateRows: number) => {
  const deleteWhere = vi.fn().mockResolvedValue({ rowsAffected: deleteRows });
  const del = vi.fn().mockReturnValue({ where: deleteWhere });
  const updateWhere = vi.fn().mockResolvedValue({ rowsAffected: updateRows });
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });
  return { client: { delete: del, update } as never, del, update };
};

describe("removeBloodlineFromPoolAtomically", () => {
  it("deletes non-NATURAL rows and nulls NATURAL rows; succeeds when rows change", async () => {
    const { client, del, update } = poolClient(2, 1);
    const ok = await removeBloodlineFromPoolAtomically({
      client,
      userId: "u1",
      bloodlineId: "bl1",
      now: new Date(0),
    });
    expect(del).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(ok).toBe(true);
  });

  it("fails when nothing changed (became equipped / not in pool)", async () => {
    const { client } = poolClient(0, 0);
    const ok = await removeBloodlineFromPoolAtomically({
      client,
      userId: "u1",
      bloodlineId: "bl1",
      now: new Date(0),
    });
    expect(ok).toBe(false);
  });
});
