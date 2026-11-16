import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import type { ItemWithEffectsProps } from "@/layout/ItemWithEffects";
import ItemWithEffects from "@/layout/ItemWithEffects";
import * as UserContext from "@/utils/UserContext";

const names = { useQuery: () => ({ data: [] }) };

const weapon = (effects: unknown[]) =>
  ({
    id: "weapon",
    name: "Weapon",
    description: "A weapon.",
    effects,
    createdAt: new Date(),
    updatedAt: new Date(),
    itemType: "WEAPON",
    canBeImbued: false,
    maxImbueNumber: 1,
  }) as unknown as ItemWithEffectsProps["item"];

const viewer = (user: Record<string, unknown> | undefined) =>
  vi
    .spyOn(UserContext, "useUserDataSelector")
    .mockImplementation(
      (select) => ({ data: user ? select(user as never) : undefined }) as never,
    );

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    bloodline: { getAllNames: names },
    sageMode: { getAllNames: names },
    skillTree: { getAllNames: names },
    item: { getAllNames: names, getEvolutions: names },
    jutsu: { getEvolutions: names },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("elemental damage details", () => {
  it("names the viewer's primary damage element", () => {
    viewer({ role: "USER", preferredDamageElement: "Water", primaryElement: "Fire" });
    const view = render(
      <ItemWithEffects item={weapon([{ type: "elementaldamage" }])} hideImage />,
    );
    expect(view.getByText("Element:").parentElement?.textContent).toBe(
      "Element: Primary damage element (yours: Water)",
    );
  });

  it("falls back to the innate element without a saved preference", () => {
    viewer({ role: "USER", preferredDamageElement: null, primaryElement: "Earth" });
    const view = render(
      <ItemWithEffects item={weapon([{ type: "elementaldamage" }])} hideImage />,
    );
    expect(view.getByText("Element:").parentElement?.textContent).toBe(
      "Element: Primary damage element (yours: Earth)",
    );
  });

  it("omits the viewer's element when signed out", () => {
    viewer(undefined);
    const view = render(
      <ItemWithEffects item={weapon([{ type: "elementaldamage" }])} hideImage />,
    );
    expect(view.getByText("Element:").parentElement?.textContent).toBe(
      "Element: Primary damage element",
    );
  });

  it("keeps fixed-element damage on its element icons", () => {
    viewer({ role: "USER", preferredDamageElement: "Water" });
    const view = render(
      <ItemWithEffects
        item={weapon([{ type: "damage", elements: ["Fire"] }])}
        hideImage
      />,
    );
    expect(view.queryByText("Element:")).toBeNull();
    expect(view.getByText("Elements:")).toBeTruthy();
  });
});
