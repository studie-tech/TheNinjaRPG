import { afterEach, describe, expect, it, vi } from "bun:test";
import { GATHERING_REQUIRED_EXP } from "@/drizzle/constants";
import { getGatheringItemDrops } from "@/libs/gathering";

afterEach(() => vi.restoreAllMocks());

describe("gathering yield", () => {
  const herb = { id: "herb", name: "Herb", rarity: "COMMON" as const };
  const ore = { id: "ore", name: "Ore", rarity: "RARE" as const };
  const experience = GATHERING_REQUIRED_EXP["D RANK"];

  it("adds units only to successful drops without additional rolls", () => {
    const roll = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.99);
    expect(getGatheringItemDrops(experience, [herb, ore], [], 2)).toEqual([
      herb,
      herb,
      herb,
    ]);
    expect(roll).toHaveBeenCalledTimes(2);
  });

  it("preserves rank and allowed-material gates", () => {
    const roll = vi.spyOn(Math, "random").mockReturnValue(0);
    expect(
      getGatheringItemDrops(experience, [{ ...herb, rarity: "LEGENDARY" }], [], 2),
    ).toEqual([]);
    expect(roll).not.toHaveBeenCalled();
    expect(getGatheringItemDrops(experience, [herb, ore], [ore.id], 2)).toEqual([
      ore,
      ore,
      ore,
    ]);
    expect(roll).toHaveBeenCalledTimes(1);
  });

  it("keeps the base yield when no bonus applies", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(getGatheringItemDrops(experience, [herb])).toEqual([herb]);
  });
});
