
import { expect, test } from "vitest";
import { BattleTypes, PvpBattleTypes } from "@/drizzle/constants";

test("BattleTypes includes RAID", () => {
  expect(BattleTypes.includes("RAID" as (typeof BattleTypes)[number])).toBe(true);
});

test("RAID is not considered PvP", () => {
  expect(PvpBattleTypes.includes("RAID" as (typeof BattleTypes)[number])).toBe(false);
});
