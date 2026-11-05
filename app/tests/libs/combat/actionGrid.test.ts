import { expect, it } from "bun:test";
import { battleActionGrid } from "@/libs/combat/actionGrid";

it("follows the small-icon setting in the game layout", () => {
  expect(battleActionGrid({ focus: false, small: true })).toEqual({
    grid: "grid grid-cols-7 md:grid-cols-9 gap-1",
    aspect: "aspect-square",
    labels: false,
  });
  expect(battleActionGrid({ focus: false, small: false })).toEqual({
    grid: "grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))]",
    aspect: undefined,
    labels: true,
  });
});

it("follows the small-icon setting in battle focus, including action names", () => {
  expect(battleActionGrid({ focus: true, small: true })).toEqual({
    grid: "grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1",
    aspect: "aspect-square",
    labels: false,
  });
  expect(battleActionGrid({ focus: true, small: false })).toEqual({
    grid: "grid grid-cols-[repeat(auto-fill,minmax(76px,1fr))] gap-1",
    aspect: "aspect-square",
    labels: true,
  });
});
