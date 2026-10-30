import { ensureDom } from "../setup/dom.mjs";
const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as characterPreview from "@/layout/CharacterPreview";
import { EquipmentPreview } from "@/layout/EquipmentPreview";
import { resolveSpriteAppearance, type SpriteUser } from "@/libs/lpc/appearance";
import type { SpriteAppearance } from "@/validators/lpc";

const browserEvents = ["Event", "CustomEvent"] as const;
const originalEvents = browserEvents.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
beforeEach(() => {
  ensureDom();
  for (const name of browserEvents) Object.defineProperty(globalThis, name, { configurable: true, value: window[name] });
  vi.spyOn(characterPreview, "CharacterPreview").mockImplementation(({ user }) => (
    <output data-testid="equipment-appearance">{JSON.stringify(resolveSpriteAppearance(user))}</output>
  ));
});
afterEach(() => {
  cleanup();
  for (const [name, descriptor] of originalEvents) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  vi.restoreAllMocks();
});

it("loads the preview only when opened and follows inventory changes instead of stale profile equipment", async () => {
  const user: SpriteUser = {
    gender: "Female", spriteBodyStyle: "female", attributes: ["Long Hair"],
    items: [{ equipped: "CHEST", item: { lpcProfile: "robe", lpcColor: "red" } }],
  };
  const item = { id: "armour", slot: "CHEST", lpcProfile: "plate", variants: [{ id: "jade", lpcColor: "green" as const }] };
  const items = [{ id: "worn", equipped: "NONE", quantity: 1, item, activeVariantId: "jade" }];
  const view = render(<EquipmentPreview user={user} items={items} />);
  expect(characterPreview.CharacterPreview).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Preview equipped appearance" }));
  const appearance = () => JSON.parse(view.getByTestId("equipment-appearance").textContent!) as SpriteAppearance;
  await waitFor(() => expect(appearance().body).toBe("female"));
  expect(appearance().layers.find((layer) => layer.slot === "shirt")).toMatchObject({ profile: "shirt", color: "black" });

  view.rerender(<EquipmentPreview user={user} items={[{ ...items[0]!, equipped: "CHEST" }]} />);
  expect(appearance().layers.find((layer) => layer.slot === "shirt")).toMatchObject({ profile: "plate", color: "green" });
  view.rerender(<EquipmentPreview user={user} items={[]} />);
  expect(appearance().layers.find((layer) => layer.slot === "shirt")).toMatchObject({ profile: "shirt", color: "black" });
  fireEvent.click(view.getByRole("button", { name: "Preview equipped appearance" }));
  await waitFor(() => expect(view.queryByTestId("equipment-appearance")).toBeNull());
});

it("does not show guessed equipment while the inventory is unavailable", () => {
  const view = render(<EquipmentPreview user={{}} items={undefined} />);
  const button = view.getByRole("button", { name: "Preview equipped appearance" });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(characterPreview.CharacterPreview).not.toHaveBeenCalled();
});
