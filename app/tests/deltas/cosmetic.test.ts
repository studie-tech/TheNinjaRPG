import { expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import { getCosmeticConsumedInventory, getCosmeticSlots } from "@/deltas/cosmetic";
import type { UserItem } from "@/drizzle/schema";

it("applies the confirmed debit and withholds stale stack quantities", () => {
  const rows = [
    { id: "source", quantity: 2 },
    { id: "other", quantity: 3 },
  ] as UserItem[];
  expect(
    getCosmeticConsumedInventory(rows, "source", 2, 1)?.map((row) => row.quantity),
  ).toEqual([1, 3]);
  expect(
    getCosmeticConsumedInventory(rows, "source", 2, 0)?.map((row) => row.id),
  ).toEqual(["other"]);
  expect(getCosmeticConsumedInventory(rows, "source", 1, 0)).toBeUndefined();
  expect(rows[0]?.quantity).toBe(2);
});

it("clears one numbered slot while retaining another selection of the same cosmetic", () => {
  const slots = [
    { slot: "HAND_1", itemId: "sword", variantId: null },
    { slot: "HAND_2", itemId: "sword", variantId: "red" },
  ] as RouterOutputs["cosmetic"]["get"]["slots"];
  expect(
    getCosmeticSlots(slots, [], { slot: "HAND_1", itemId: null, variantId: null }),
  ).toEqual(slots.slice(1));
  expect(slots).toHaveLength(2);
});
