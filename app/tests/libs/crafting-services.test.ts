import { expect, it } from "bun:test";
import type { Item, UserItemWithRelations } from "@/drizzle/schema";
import {
  getServiceRepairDurability,
  serviceImbueCompatibilityError,
  serviceImbueError,
} from "@/libs/craftingServices";

it.each([
  ["NOVICE", 105],
  ["APPRENTICE", 110],
  ["MASTER", 115],
  ["FORGEMASTER", 120],
] as const)("repairs a 100-durability item to %s's exact bonus", (rank, durability) => {
  expect(getServiceRepairDurability(100, rank)).toBe(durability);
});

const target = {
  item: {
    canBeImbued: true,
    itemType: "WEAPON",
    battleUsageType: "ALL",
    maxImbueNumber: 3,
  },
  imbuements: [],
} as unknown as UserItemWithRelations;
const crystal = { id: "crystal", itemType: "CRYSTAL", rarity: "COMMON" } as Item;

it.each([
  [{ ...crystal, crystalTargetTypes: "ARMOR" }, "MASTER", target, "incompatible"],
  [{ ...crystal, battleUsageType: "PVE" }, "MASTER", target, "PvE-only"],
  [{ ...crystal, rarity: "LEGENDARY" }, "MASTER", target, "rarity"],
  [
    crystal,
    "MASTER",
    { ...target, imbuements: [{ imbuementItemId: "one" }, { imbuementItemId: "two" }] },
    "limit",
  ],
  [
    crystal,
    "MASTER",
    { ...target, imbuements: [{ imbuementItemId: "crystal" }] },
    "already",
  ],
] as const)(
  "shares crystal compatibility restrictions with submitted service work",
  (gem, rank, equipment, message) => {
    const row = equipment as UserItemWithRelations;
    expect(serviceImbueCompatibilityError(row, gem as Item, rank)).toContain(message);
    expect(serviceImbueError(row, gem as Item, rank, {})).toContain(message);
  },
);

it("allows a compatible crystal while retaining the server's private skill gate", () => {
  expect(serviceImbueCompatibilityError(target, crystal, "MASTER")).toBeNull();
  const skilledCrystal = { ...crystal, requiredSkillId: "imbuing" };
  expect(serviceImbueCompatibilityError(target, skilledCrystal, "MASTER")).toBeNull();
  expect(serviceImbueError(target, skilledCrystal, "MASTER", {})).toContain(
    "required skill",
  );
});
