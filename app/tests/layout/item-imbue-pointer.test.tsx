import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import type { GenericObject } from "@/layout/ItemWithEffects";
import * as UserContext from "@/utils/UserContext";
import { actualItemWithEffects as ItemWithEffects } from "../setup/preload";

const names = { useQuery: () => ({ data: [] }) };

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    bloodline: { getAllNames: names }, sageMode: { getAllNames: names },
    skillTree: { getAllNames: names },
    item: { getAllNames: names, getEvolutions: names },
    jutsu: { getEvolutions: names },
  });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role: "USER" } } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const item = (canBeImbued: boolean) =>
  ({
    id: "armor", name: "Armor", description: "Worn.", createdAt: new Date(), updatedAt: new Date(),
    effects: [], canBeImbued,
  }) as unknown as GenericObject;

it("tells players where imbuing happens on items that can be imbued", () => {
  const view = render(<ItemWithEffects item={item(true)} hideImage />);
  const pointer = view.getByTestId("item-imbue-pointer").textContent;
  expect(pointer).toContain("Occupation > Crafting");
  expect(pointer).toContain("Apprentice rank");
});

it("shows no imbue pointer on other items", () => {
  const view = render(<ItemWithEffects item={item(false)} hideImage />);
  expect(view.queryByTestId("item-imbue-pointer")).toBeNull();
});
