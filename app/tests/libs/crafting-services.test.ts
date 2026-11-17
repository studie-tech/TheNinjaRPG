import { expect, it } from "bun:test";
import { getServiceRepairDurability } from "@/libs/craftingServices";

it.each([
  ["NOVICE", 105],
  ["APPRENTICE", 110],
  ["MASTER", 115],
  ["FORGEMASTER", 120],
] as const)("repairs a 100-durability item to %s's exact bonus", (rank, durability) => {
  expect(getServiceRepairDurability(100, rank)).toBe(durability);
});
