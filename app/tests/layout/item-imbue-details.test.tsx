import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import type { ItemWithEffectsProps } from "@/layout/ItemWithEffects";
import ItemWithEffects from "@/layout/ItemWithEffects";
import * as UserContext from "@/utils/UserContext";

const names = { useQuery: () => ({ data: [] }) };

const item = (overrides: Record<string, unknown>) =>
  ({
    id: "item",
    name: "Item",
    description: "An item.",
    effects: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    itemType: "ARMOR",
    canBeImbued: false,
    maxImbueNumber: 1,
    ...overrides,
  }) as unknown as ItemWithEffectsProps["item"];

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    bloodline: { getAllNames: names },
    sageMode: { getAllNames: names },
    skillTree: { getAllNames: names },
    item: { getAllNames: names, getEvolutions: names },
    jutsu: { getEvolutions: names },
  });
  vi.spyOn(UserContext, "useUserData").mockReturnValue({
    data: { role: "USER" },
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("imbue details", () => {
  it.each(["ARMOR", "WEAPON", "CONSUMABLE", "ACCESSORY", "OTHER"])(
    "hides the crystal cap on %s that cannot be imbued",
    (itemType) => {
      const view = render(<ItemWithEffects item={item({ itemType })} hideImage />);
      expect(view.queryByText("Max Imbue Number")).toBeNull();
      expect(view.queryByText("Can be Imbued")).toBeNull();
    },
  );

  it.each(["ARMOR", "WEAPON", "CONSUMABLE"])(
    "shows the crystal cap on imbuable %s",
    (itemType) => {
      const view = render(
        <ItemWithEffects
          item={item({ itemType, canBeImbued: true, maxImbueNumber: 2 })}
          hideImage
        />,
      );
      expect(view.getByText("Max Imbue Number").parentElement?.textContent).toBe(
        "Max Imbue Number: 2",
      );
      expect(view.getByText("Can be Imbued").parentElement?.textContent).toBe(
        "Can be Imbued: yes",
      );
    },
  );

  it("keeps a crystal's target types without a crystal cap", () => {
    const view = render(
      <ItemWithEffects
        item={item({ itemType: "CRYSTAL", crystalTargetTypes: "ARMOR" })}
        hideImage
      />,
    );
    expect(view.getByText("Can Imbue:").parentElement?.textContent).toContain("ARMOR");
    expect(view.queryByText("Max Imbue Number")).toBeNull();
  });
});
