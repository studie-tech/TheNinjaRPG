import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { refundPityCredit, reservePityCredit } from "@/server/utils/concurrency";
import { bloodlineRolls, sageModeRolls } from "@/drizzle/schema";

const makeClient = (rowsAffected: number) => {
  const where = vi.fn().mockResolvedValue({ rowsAffected });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { client: { update } as never, update, set, where };
};

describe("reservePityCredit", () => {
  it("returns true when the CAS updates exactly one row", async () => {
    const { client, where } = makeClient(1);
    const won = await reservePityCredit({
      client,
      table: bloodlineRolls,
      rollId: "roll1",
      expectedPityRolls: 2,
    });
    expect(won).toBe(true);
    // The reservation is only safe if the CAS is scoped to BOTH the roll id and the
    // expected pity count — dropping the pityRolls equality would let a stale request
    // fund a second grant. Assert the predicate, not just the mocked outcome.
    expect(where).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledWith(
      and(eq(bloodlineRolls.id, "roll1"), eq(bloodlineRolls.pityRolls, 2)),
    );
  });

  it("returns false when the CAS matches zero rows (stale count / lost race)", async () => {
    const { client, where } = makeClient(0);
    const won = await reservePityCredit({
      client,
      table: bloodlineRolls,
      rollId: "roll1",
      expectedPityRolls: 2,
    });
    expect(won).toBe(false);
    expect(where).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledWith(
      and(eq(bloodlineRolls.id, "roll1"), eq(bloodlineRolls.pityRolls, 2)),
    );
  });
});

describe("refundPityCredit", () => {
  it("issues a single decrement scoped to the roll id on the given table", async () => {
    const { client, update, set, where } = makeClient(1);
    await refundPityCredit({ client, table: sageModeRolls, rollId: "roll1" });
    // Unconditional decrement (no expectedPityRolls guard): one update, one set, one where.
    expect(update).toHaveBeenCalledWith(sageModeRolls);
    expect(set).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("does not throw when the refund matches zero rows", async () => {
    const { client } = makeClient(0);
    await expect(
      refundPityCredit({ client, table: bloodlineRolls, rollId: "roll1" }),
    ).resolves.toBeUndefined();
  });
});
