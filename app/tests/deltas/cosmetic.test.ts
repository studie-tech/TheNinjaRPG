import { expect, it } from "bun:test";
import type { RouterOutputs } from "@/app/_trpc/client";
import { getCosmeticSlots } from "@/deltas/cosmetic";

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
