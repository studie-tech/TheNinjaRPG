import { describe, expect, it, vi } from "vitest";
import { reservePityCredit } from "@/server/utils/concurrency";
import { bloodlineRolls } from "@/drizzle/schema";

const makeClient = (rowsAffected: number) => {
  const where = vi.fn().mockResolvedValue({ rowsAffected });
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { client: { update } as never, update, set, where };
};

describe("reservePityCredit", () => {
  it("returns true when the CAS updates exactly one row", async () => {
    const { client } = makeClient(1);
    const won = await reservePityCredit({
      client,
      table: bloodlineRolls,
      rollId: "roll1",
      expectedPityRolls: 2,
    });
    expect(won).toBe(true);
  });

  it("returns false when the CAS matches zero rows (stale count / lost race)", async () => {
    const { client } = makeClient(0);
    const won = await reservePityCredit({
      client,
      table: bloodlineRolls,
      rollId: "roll1",
      expectedPityRolls: 2,
    });
    expect(won).toBe(false);
  });
});
