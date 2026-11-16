import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { RouterOutputs } from "@/app/_trpc/client";
import * as contentImage from "@/layout/ContentImage";
import * as equipmentPreview from "@/layout/EquipmentPreview";
import * as image from "@/layout/Image";
import { CosmeticWorkspace } from "@/layout/items/CosmeticWorkspace";
import type { SpriteUser } from "@/libs/lpc/appearance";
import { mockCosmetics } from "../../setup/cosmetics";

type Wardrobe = RouterOutputs["cosmetic"]["get"];

const helmet = {
  id: "helmet",
  name: "Helmet",
  slot: "HEAD",
  itemType: "ARMOR",
  image: "/helmet.webp",
  variants: [
    { id: "gold", name: "Gold helmet", image: "/gold.webp" },
    { id: "locked", name: "Locked helmet", image: "/locked.webp" },
  ],
} as Wardrobe["owned"][number]["item"];

let state: ReturnType<typeof mockCosmetics>;

beforeEach(() => {
  state = mockCosmetics();
  state.wardrobe.data = {
    owned: [{ item: helmet }],
    slots: [],
    unlocks: [{ variantId: "gold" }],
  } as unknown as Wardrobe;
  vi.spyOn(equipmentPreview, "EquipmentPreview").mockImplementation(() => (
    <button type="button">Preview</button>
  ));
  vi.spyOn(contentImage, "default").mockImplementation(() => <span />);
  // biome-ignore lint/performance/noImgElement: isolated silhouette fixture
  vi.spyOn(image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = () => render(<CosmeticWorkspace user={{ items: [] } as SpriteUser} />);

it("keeps the compact selector and figure on the same cosmetic slot", () => {
  mount();
  const selector = screen.getByRole("combobox", { name: "Slot" });
  expect((selector as HTMLSelectElement).value).toBe("HEAD");
  fireEvent.change(selector, { target: { value: "CHEST" } });
  expect(screen.getByRole("region", { name: "Chest cosmetic choices" })).toBeDefined();
  expect(screen.queryByRole("button", { name: "Gold helmet" })).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Chest cosmetic, empty" })
      .getAttribute("aria-current"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Head cosmetic, empty" }));
  expect((selector as HTMLSelectElement).value).toBe("HEAD");
  expect(screen.getByRole("button", { name: "Gold helmet" })).toBeDefined();
});

it("offers the base appearance and only unlocked variants in the chosen slot", () => {
  mount();
  const choices = within(screen.getByRole("region", { name: "Head cosmetic choices" }));
  expect(choices.queryByRole("button", { name: "Locked helmet" })).toBeNull();
  fireEvent.click(choices.getByRole("button", { name: "Gold helmet" }));
  expect(state.select.mutate).toHaveBeenLastCalledWith({
    slot: "HEAD",
    itemId: "helmet",
    variantId: "gold",
  });
  fireEvent.click(choices.getByRole("button", { name: /^Helmet$/ }));
  expect(state.select.mutate).toHaveBeenLastCalledWith({
    slot: "HEAD",
    itemId: "helmet",
    variantId: null,
  });
});

it("keeps removal available for a saved cosmetic on an empty gear slot", () => {
  state.wardrobe.data.slots = [
    {
      userId: "viewer",
      slot: "HEAD",
      itemId: "helmet",
      variantId: null,
      item: helmet,
      variant: null,
    },
  ] as Wardrobe["slots"];
  const view = mount();
  expect(
    screen.getByText("Saved. Equip gear in this slot to display the cosmetic."),
  ).toBeDefined();
  expect(
    (screen.getByRole("button", { name: "Helmet · Selected" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Remove cosmetic" }));
  expect(state.select.mutate).toHaveBeenLastCalledWith({ slot: "HEAD", itemId: null });

  state.select.isPending = true;
  view.rerender(<CosmeticWorkspace user={{ items: [] } as SpriteUser} />);
  expect(
    (screen.getByRole("button", { name: "Remove cosmetic" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Gold helmet" }) as HTMLButtonElement).disabled,
  ).toBe(true);
});
