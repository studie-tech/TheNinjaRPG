import { describe, expect, it } from "bun:test";
import { STRUCTURE_ADJACENTS } from "@/drizzle/constants";

describe("STRUCTURE_ADJACENTS", () => {
  it("covers the structure tile and every neighbour of either hex column parity", () => {
    const offsets = new Set(
      STRUCTURE_ADJACENTS.map(({ dCol, dRow }) => `${dCol},${dRow}`),
    );
    expect([...offsets].sort()).toEqual(
      ["-1,-1", "-1,0", "-1,1", "0,-1", "0,0", "0,1", "1,-1", "1,0", "1,1"].sort(),
    );
    expect(STRUCTURE_ADJACENTS).toHaveLength(offsets.size);
  });
});
