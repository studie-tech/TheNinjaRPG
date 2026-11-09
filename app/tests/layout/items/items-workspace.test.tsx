import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import type { ItemSlot } from "@/drizzle/constants";
import type { UserItemWithRelations } from "@/drizzle/schema";
import * as bulkSell from "@/hooks/useBulkSellItems";
import * as homeMove from "@/hooks/useHomeStorageMove";
import * as itemActions from "@/hooks/useItemActions";
import * as contentImage from "@/layout/ContentImage";
import * as equipmentPreview from "@/layout/EquipmentPreview";
import * as hotkeyControls from "@/layout/HotkeyControls";
import * as image from "@/layout/Image";
import * as itemWithEffects from "@/layout/ItemWithEffects";
import { USER_ITEM_DRAG_TYPE } from "@/layout/items/ItemCard";
import * as inspector from "@/layout/items/ItemInspector";
import { ItemsWorkspace } from "@/layout/items/ItemsWorkspace";
import * as itemLib from "@/libs/item";
import * as mastery from "@/libs/mastery";
import * as skills from "@/libs/skillRequirements";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

let equip: ReturnType<typeof vi.fn>;
let settle: () => void;
let inspectorEquip: ReturnType<typeof vi.fn>;
let isEquipping = false;
let containerWidth = 1000;
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

const setFinePointer = (fine: boolean) =>
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(any-pointer: fine)" && fine,
      addEventListener() {},
      removeEventListener() {},
    }),
  });

beforeEach(() => {
  window.localStorage.clear();
  equip = vi.fn();
  inspectorEquip = vi.fn();
  isEquipping = false;
  settle = () => {};
  vi.spyOn(itemActions, "useItemActions").mockImplementation(((options: {
    useritem?: UserItemWithRelations;
    onDone: () => void;
  }) => {
    if (!options.useritem) settle = options.onDone;
    return {
      equip: options.useritem ? inspectorEquip : equip,
      merge: vi.fn(),
      isEquipping: options.useritem ? false : isEquipping,
      isPending: false,
    };
  }) as never);
  vi.spyOn(bulkSell, "useBulkSellItems").mockReturnValue({
    sellMany: vi.fn(),
    isSelling: false,
  });
  vi.spyOn(homeMove, "useHomeStorageMove").mockReturnValue({
    moveItems: vi.fn(),
    isMoving: false,
  });
  setFinePointer(true);
  containerWidth = 1000;
  // The workspace measures its own width to choose inline panels or a bottom sheet.
  installBrowserGlobals({
    resizeObserver: class {
      constructor(
        private readonly callback: (
          entries: { contentRect: { width: number } }[],
        ) => void,
      ) {}
      observe() {
        this.callback([{ contentRect: { width: containerWidth } }]);
      }
      unobserve() {}
      disconnect() {}
    },
  });
  vi.spyOn(hotkeyControls, "useHotkeyAssignment").mockReturnValue({
    hotkeys: { byAction: {} },
    assign: vi.fn(),
    dialog: null,
  } as never);
  vi.spyOn(equipmentPreview, "EquipmentPreview").mockImplementation(() => (
    <button type="button">Preview</button>
  ));
  vi.spyOn(contentImage, "default").mockImplementation(({ alt }) => (
    <span>{alt} art</span>
  ));
  // biome-ignore lint/performance/noImgElement: isolated silhouette fixture
  vi.spyOn(image, "default").mockImplementation(({ alt }) => <img alt={alt} />);
  vi.spyOn(mastery, "gearMissingMastery").mockReturnValue(null as never);
  vi.spyOn(skills, "hasRequiredSkill").mockReturnValue(true);
  vi.spyOn(inspector, "ItemInspector").mockImplementation(({ userItem, onClose }) => (
    <section aria-label={`Inspecting ${userItem.item.name}`}>
      <button type="button" onClick={onClose}>
        Back
      </button>
    </section>
  ));
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  window.localStorage.clear();
  if (originalMatchMedia)
    Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
  restoreBrowserGlobals();
});

const gear = (id: string, slot: string, equipped: ItemSlot = "NONE") =>
  ({
    id,
    itemId: `item-${id}`,
    quantity: 1,
    level: 1,
    durability: 50,
    equipped,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    storedAtHome: false,
    isInAuction: false,
    craftingFinishedAt: null,
    imbuements: [],
    item: {
      id: `item-${id}`,
      name: id,
      image: null,
      rarity: "RARE",
      itemType: "WEAPON",
      slot,
      maxDurability: 50,
      hidden: false,
      effects: [],
      inShop: true,
    },
  }) as unknown as UserItemWithRelations;

const katana = gear("Shadowsteel Katana", "HAND", "HAND_1");
const tanto = gear("Raijin Tanto", "HAND");
const pill = gear("Chakra Pill", "ITEM");
const player = {
  userId: "user-1",
  role: "USER",
  status: "AWAKE",
  battleId: null,
  items: [],
} as never;

const renderWorkspace = (props: Partial<Parameters<typeof ItemsWorkspace>[0]> = {}) => {
  const all = props.userItems ?? [katana, tanto, pill];
  const tree = (next: Partial<Parameters<typeof ItemsWorkspace>[0]>) => (
    <ItemsWorkspace
      userData={player}
      userItems={all}
      bagItems={all.filter((ui) => ui.equipped === "NONE")}
      bag="normal"
      {...props}
      {...next}
    />
  );
  const view = render(tree({}));
  return {
    view,
    rerender: (next: Partial<Parameters<typeof ItemsWorkspace>[0]>) =>
      view.rerender(tree(next)),
  };
};

const slotOf = (slot: ItemSlot) =>
  document.querySelector<HTMLButtonElement>(`[data-slot="${slot}"]`)!;
const card = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`^${name}`) });

it("opens the slot picker for a slot and the inspector for an item", () => {
  renderWorkspace();
  act(() => {
    fireEvent.click(slotOf("HAND_1"));
  });
  expect(screen.getByRole("heading", { name: "Hand slot" })).toBeDefined();
  expect(slotOf("HAND_1").getAttribute("aria-current")).toBe("true");
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
  });
  expect(
    screen.getByRole("region", { name: "Inspecting Shadowsteel Katana" }),
  ).toBeDefined();
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
  });
  act(() => {
    fireEvent.click(card("Raijin Tanto"));
  });
  expect(screen.getByRole("region", { name: "Inspecting Raijin Tanto" })).toBeDefined();
});

it.each([1000, 390])(
  "returns focus to the equipment tile after inspecting from its picker at width %s",
  async (width) => {
    useRealInspector();
    containerWidth = width;
    renderWorkspace();
    const trigger = slotOf("HAND_1");
    act(() => trigger.focus());
    act(() => fireEvent.click(trigger));
    const inspect = screen.getByRole("button", { name: "Inspect" });
    act(() => inspect.focus());
    act(() => fireEvent.click(inspect));
    expect(inspect.isConnected).toBe(false);
    const close = await screen.findByRole("button", { name: "← Back" });
    await waitFor(() => expect(document.activeElement === close).toBe(true));
    act(() => fireEvent.keyDown(close, { key: "Escape" }));
    await waitFor(() => expect(document.activeElement === trigger).toBe(true));
  },
);

it.each([1000, 390])(
  "focuses the backpack after navigating there from a slot picker at width %s",
  async (width) => {
    containerWidth = width;
    renderWorkspace();
    const trigger = slotOf("HAND_1");
    act(() => trigger.focus());
    act(() => fireEvent.click(trigger));
    const showBackpack = screen.getByRole("button", { name: "Show Backpack" });
    act(() => showBackpack.focus());
    act(() => fireEvent.click(showBackpack));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const backpack = screen.getByRole("tabpanel", { name: "Backpack · 2" });
    expect(
      screen.getByRole("tab", { name: "Backpack · 2" }).getAttribute("aria-selected"),
    ).toBe("true");
    await waitFor(() => expect(document.activeElement === backpack).toBe(true));
  },
);

it.each(["backpack", "equipment"])(
  "returns focus to the %s trigger after inspecting through its menu",
  async (source) => {
    useRealInspector();
    renderWorkspace();
    const trigger = source === "backpack" ? card("Raijin Tanto") : slotOf("HAND_1");
    // A pointer context menu need not focus the card before focusing its menu item.
    act(() => fireEvent.contextMenu(trigger));
    const inspect = screen.getByRole("menuitem", { name: "Inspect" });
    act(() => inspect.focus());
    act(() => fireEvent.keyDown(inspect, { key: "Enter" }));
    const close = await screen.findByRole("button", { name: "← Back" });
    await waitFor(() => expect(document.activeElement === close).toBe(true));
    expect(inspect.isConnected).toBe(false);
    act(() => fireEvent.keyDown(close, { key: "Escape" }));
    await waitFor(() => expect(document.activeElement === trigger).toBe(true));
  },
);

it("returns focus to another equipment tile when it opens a new picker", async () => {
  renderWorkspace();
  act(() => slotOf("HAND_1").focus());
  act(() => fireEvent.click(slotOf("HAND_1")));
  const trigger = slotOf("HEAD");
  act(() => trigger.focus());
  act(() => fireEvent.click(trigger));
  act(() =>
    fireEvent.keyDown(screen.getByRole("button", { name: "Close slot picker" }), {
      key: "Escape",
    }),
  );
  await waitFor(() => expect(document.activeElement === trigger).toBe(true));
});

it("focuses the inspector when its equipment menu selects the already inspected item", async () => {
  useRealInspector();
  renderWorkspace();
  act(() => fireEvent.click(slotOf("HAND_1")));
  act(() => fireEvent.click(screen.getByRole("button", { name: "Inspect" })));
  act(() => fireEvent.contextMenu(slotOf("HAND_1")));
  const inspect = screen.getByRole("menuitem", { name: "Inspect" });
  act(() => inspect.focus());
  act(() => fireEvent.keyDown(inspect, { key: "Enter" }));
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  await waitFor(() =>
    expect(
      document.activeElement === screen.getByRole("button", { name: "← Back" }),
    ).toBe(true),
  );
});

it("equips from the slot picker into that slot", () => {
  renderWorkspace();
  act(() => {
    fireEvent.click(slotOf("HAND_2"));
  });
  fireEvent.click(screen.getByRole("button", { name: "Equip Raijin Tanto" }));
  expect(equip.mock.calls[0]?.[0]).toEqual({
    userItemId: "Raijin Tanto",
    slot: "HAND_2",
  });
});

it("changing bag resets the right column", () => {
  const { rerender } = renderWorkspace();
  act(() => {
    fireEvent.click(card("Raijin Tanto"));
  });
  expect(screen.getByRole("region", { name: "Inspecting Raijin Tanto" })).toBeDefined();
  rerender({ bag: "event", bagItems: [] });
  expect(screen.queryByRole("region", { name: /Inspecting/ })).toBeNull();
  expect(document.querySelector("[data-items-panel]")).toBeNull();
  expect(screen.getByRole("heading", { name: "Backpack" })).toBeDefined();
});

it("returns to backpack when the inspected item is gone", () => {
  const { rerender } = renderWorkspace();
  act(() => {
    fireEvent.click(card("Chakra Pill"));
  });
  expect(screen.getByRole("region", { name: "Inspecting Chakra Pill" })).toBeDefined();
  // Sold or used up: the item leaves the inventory while its panel is open.
  rerender({ userItems: [katana, tanto], bagItems: [tanto] });
  expect(screen.queryByRole("region", { name: /Inspecting/ })).toBeNull();
  expect(document.querySelector("[data-items-panel]")).toBeNull();
});

it("phone shows tabs and opens panels in a bottom sheet", () => {
  containerWidth = 390;
  renderWorkspace();
  const [equipmentTab, backpackTab] = screen.getAllByRole("tab");
  expect(equipmentTab?.getAttribute("aria-selected")).toBe("true");
  expect(backpackTab?.textContent).toBe("Backpack · 2");
  act(() => {
    fireEvent.mouseDown(backpackTab!, { button: 0, ctrlKey: false });
  });
  expect(backpackTab?.getAttribute("aria-selected")).toBe("true");
  act(() => {
    fireEvent.click(card("Raijin Tanto"));
  });
  // A modal sheet above every layout's navigation, not a panel inside the page.
  const sheet = screen.getByRole("dialog");
  expect(
    sheet.contains(screen.getByRole("region", { name: "Inspecting Raijin Tanto" })),
  ).toBe(true);
  // Size containment would collapse a content-sized bottom sheet to its padding.
  expect(sheet.style.contain).toBe("layout paint");
  expect(document.querySelector("[data-items-panel]")).toBeNull();
});

it("navigates phone panels with arrows, Home and End while retaining their triggers", async () => {
  containerWidth = 390;
  renderWorkspace();
  const equipment = screen.getByRole("tab", { name: "Equipment" });
  const backpack = screen.getByRole("tab", { name: "Backpack · 2" });
  const equipmentPanel = screen.getByRole("tabpanel", { name: "Equipment" });
  const backpackPanel = screen.getByRole("tabpanel", { name: "Backpack · 2" });
  const equipmentTrigger = slotOf("HAND_1");
  const backpackTrigger = card("Raijin Tanto");
  expect(equipment.getAttribute("aria-controls")).toBe(equipmentPanel.id);
  expect(backpack.getAttribute("aria-controls")).toBe(backpackPanel.id);
  expect(equipmentPanel.getAttribute("aria-labelledby")).toBe(equipment.id);
  expect(backpackPanel.getAttribute("aria-labelledby")).toBe(backpack.id);
  act(() => equipment.focus());
  for (const [key, target] of [
    ["ArrowRight", backpack],
    ["ArrowLeft", equipment],
    ["End", backpack],
    ["Home", equipment],
  ] as const) {
    fireEvent.keyDown(document.activeElement as HTMLElement, { key });
    await waitFor(() => expect(document.activeElement === target).toBe(true));
    expect(target.getAttribute("aria-selected")).toBe("true");
    expect(target.tabIndex).toBe(0);
    expect((target === equipment ? backpack : equipment).tabIndex).toBe(-1);
    expect(slotOf("HAND_1")).toBe(equipmentTrigger);
    expect(card("Raijin Tanto")).toBe(backpackTrigger);
  }
});

it("names the phone inspector sheet with the active variant name", () => {
  containerWidth = 400;
  const sword = {
    ...tanto,
    activeVariantId: "blue",
    item: {
      ...tanto.item,
      variants: [{ id: "blue", image: "/blue.webp", name: "Blue Tanto" }],
    },
  } as UserItemWithRelations;
  renderWorkspace({ userItems: [sword] });
  act(() =>
    fireEvent.mouseDown(screen.getAllByRole("tab")[1]!, { button: 0, ctrlKey: false }),
  );
  act(() => fireEvent.click(card("Blue Tanto")));
  expect(screen.getByRole("dialog", { name: "Blue Tanto" })).toBeDefined();
});

it("show backpack from the picker switches the phone tab", () => {
  renderWorkspace();
  act(() => {
    fireEvent.click(slotOf("HEAD"));
  });
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Show Backpack" }));
  });
  expect(screen.getAllByRole("tab")[1]?.getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByRole("heading", { name: "Head slot" })).toBeNull();
});

it("drags a backpack item onto a fitting slot only", () => {
  renderWorkspace();
  act(() => {
    fireEvent.dragStart(card("Raijin Tanto"), {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
  });
  expect(slotOf("HEAD").className).toContain("opacity-40");
  expect(slotOf("HAND_2").className).not.toContain("opacity-40");
  const getData = (type: string) =>
    type === USER_ITEM_DRAG_TYPE ? "Raijin Tanto" : "";
  act(() => {
    fireEvent.drop(slotOf("HEAD"), { dataTransfer: { getData } });
  });
  expect(equip).not.toHaveBeenCalled();
  act(() => {
    fireEvent.drop(slotOf("HAND_2"), { dataTransfer: { getData } });
  });
  expect(equip.mock.calls[0]?.[0]).toEqual({
    userItemId: "Raijin Tanto",
    slot: "HAND_2",
  });
});

it("does not drag worn gear, which the server will not move", () => {
  renderWorkspace();
  expect(slotOf("HAND_1").getAttribute("draggable")).not.toBe("true");
  expect(card("Raijin Tanto").getAttribute("draggable")).toBe("true");
});

it("does not offer drag on touch-only devices", () => {
  setFinePointer(false);
  renderWorkspace();
  expect(card("Raijin Tanto").getAttribute("draggable")).not.toBe("true");
});

it("sends one equip per change until it settles", () => {
  renderWorkspace();
  act(() => {
    fireEvent.click(slotOf("HAND_2"));
  });
  const button = screen.getByRole("button", { name: "Equip Raijin Tanto" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(equip).toHaveBeenCalledTimes(1);
  // Another action settling, such as a merge, does not release the pending equip.
  act(() => settle());
  fireEvent.click(button);
  expect(equip).toHaveBeenCalledTimes(1);
  act(() => equip.mock.calls[0]?.[1]?.onSettled?.());
  fireEvent.click(button);
  expect(equip).toHaveBeenCalledTimes(2);
});

it("keeps hidden items out of the slot picker for players", () => {
  const secret = {
    ...gear("Secret Blade", "HAND"),
    item: { ...gear("Secret Blade", "HAND").item, hidden: true },
  } as UserItemWithRelations;
  renderWorkspace({ userItems: [katana, tanto, secret] });
  act(() => {
    fireEvent.click(slotOf("HAND_2"));
  });
  expect(screen.queryByRole("button", { name: "Equip Secret Blade" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Secret Blade/ })).toBeNull();
  expect(screen.getAllByRole("tab")[1]?.textContent).toBe("Backpack · 1");
});

it("shows the bag's capacity beside the backpack heading and its tabs below", () => {
  renderWorkspace({ backpackStatus: <p>4 / 20</p>, bagTabs: <p>Bag tabs</p> });
  const heading = screen.getByRole("heading", { name: "Backpack" });
  expect(heading.parentElement?.textContent).toBe("BackpackSelect4 / 20");
  expect(heading.parentElement?.nextElementSibling?.textContent).toBe("Bag tabs");
});

it("opens the phone sheet with focus on the sheet, not its close button", () => {
  containerWidth = 390;
  renderWorkspace();
  act(() => {
    fireEvent.mouseDown(screen.getAllByRole("tab")[1]!, { button: 0, ctrlKey: false });
  });
  act(() => {
    fireEvent.click(card("Raijin Tanto"));
  });
  expect(document.activeElement === screen.getByRole("dialog")).toBe(true);
});

it("puts the phone sheet's close button in the panel's own top bar", () => {
  containerWidth = 390;
  vi.spyOn(inspector, "ItemInspector").mockImplementation(({ userItem }) => (
    <section aria-label={`Inspecting ${userItem.item.name}`}>
      <button type="button">Close inspector</button>
    </section>
  ));
  renderWorkspace();
  act(() => {
    fireEvent.mouseDown(screen.getAllByRole("tab")[1]!, { button: 0, ctrlKey: false });
  });
  act(() => {
    fireEvent.click(card("Raijin Tanto"));
  });
  const sheet = screen.getByRole("dialog");
  // The panel header owns the sheet's sole close control.
  expect(
    within(sheet)
      .getAllByRole("button", { name: /close/i })
      .map((b) => b.textContent),
  ).toEqual(["Close inspector"]);
});

/** Keep the inspector's real action controls to exercise toggles across panel changes. */
const useRealInspector = () => {
  vi.spyOn(inspector, "ItemInspector").mockRestore();
  Object.assign(vi.spyOn(client, "api" as never), {
    item: { getEvolutions: { useQuery: () => ({ data: [] }) } },
  });
  vi.spyOn(itemWithEffects, "default").mockImplementation(() => <p>Item effects</p>);
  vi.spyOn(itemLib, "calcItemSellingPrice").mockReturnValue(120);
};

it.each([1000, 390])(
  "equips an inspected slot candidate into the selected empty hand at width %s",
  (width) => {
    useRealInspector();
    containerWidth = width;
    renderWorkspace({ userItems: [tanto] });
    act(() => fireEvent.click(slotOf("HAND_1")));
    act(() =>
      fireEvent.click(screen.getByRole("button", { name: "Details of Raijin Tanto" })),
    );
    fireEvent.click(screen.getByRole("button", { name: "Equip in Hand 1" }));
    expect(equip.mock.calls[0]?.[0]).toEqual({ userItemId: tanto.id, slot: "HAND_1" });
    expect(inspectorEquip).not.toHaveBeenCalled();
  },
);

it("offers the selected slot when inspecting an item equipped in another hand", () => {
  useRealInspector();
  const worn = { ...katana, item: { ...katana.item, maxEquips: 2 } };
  renderWorkspace({ userItems: [worn] });
  act(() => fireEvent.click(slotOf("HAND_2")));
  act(() =>
    fireEvent.click(
      screen.getByRole("button", { name: "Details of Shadowsteel Katana" }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Equip in Hand 2" }));
  expect(equip.mock.calls[0]?.[0]).toEqual({ userItemId: worn.id, slot: "HAND_2" });
});

it("keeps the equip-limit restriction when inspecting a candidate worn elsewhere", () => {
  useRealInspector();
  const worn = { ...katana, item: { ...katana.item, maxEquips: 1 } };
  renderWorkspace({ userItems: [worn] });
  act(() => fireEvent.click(slotOf("HAND_2")));
  act(() =>
    fireEvent.click(
      screen.getByRole("button", { name: "Details of Shadowsteel Katana" }),
    ),
  );
  const equipButton = screen.getByRole("button", {
    name: "Equip in Hand 2",
  }) as HTMLButtonElement;
  expect(equipButton.disabled).toBe(true);
  expect(screen.getByText("Unequip from Hand 1 first")).toBeDefined();
  fireEvent.click(equipButton);
  expect(equip).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Unequip" }));
  expect(equip.mock.calls[0]?.[0]).toEqual({ userItemId: worn.id, slot: "HAND_1" });
});

it("checks mastery after removing the selected slot's current item in the inspector", () => {
  useRealInspector();
  vi.spyOn(mastery, "gearMissingMastery").mockImplementation((_item, wearer) =>
    wearer.items?.some((ui) => ui.id === katana.id)
      ? null
      : ({ required: 500, current: 0, label: "Bukijutsu" } as never),
  );
  renderWorkspace();
  act(() => fireEvent.click(slotOf("HAND_1")));
  act(() =>
    fireEvent.click(screen.getByRole("button", { name: "Details of Raijin Tanto" })),
  );
  const equipButton = screen.getByRole("button", {
    name: "Equip in Hand 1",
  }) as HTMLButtonElement;
  expect(equipButton.disabled).toBe(true);
  expect(screen.getByText("Needs 500 Bukijutsu")).toBeDefined();
  fireEvent.click(equipButton);
  expect(equip).not.toHaveBeenCalled();
});

it("shares an unequip guard and pending state with the inspector opened from its slot", () => {
  useRealInspector();
  const { rerender } = renderWorkspace();
  act(() => fireEvent.click(slotOf("HAND_1")));
  fireEvent.click(screen.getByRole("button", { name: "Unequip" }));
  act(() => fireEvent.click(screen.getByRole("button", { name: "Inspect" })));
  // The ref also guards a second click before React renders mutation pending state.
  fireEvent.click(screen.getByRole("button", { name: "Unequip" }));
  expect(equip).toHaveBeenCalledTimes(1);
  expect(inspectorEquip).not.toHaveBeenCalled();
  isEquipping = true;
  rerender({});
  expect(screen.queryByRole("button", { name: "Unequip" })).toBeNull();
  expect(screen.getByText("Equipping")).toBeDefined();
});

it("keeps an inspector unequip guarded after closing it and inspecting through the equipment menu", async () => {
  useRealInspector();
  renderWorkspace();
  act(() => fireEvent.click(slotOf("HAND_1")));
  act(() => fireEvent.click(screen.getByRole("button", { name: "Inspect" })));
  fireEvent.click(screen.getByRole("button", { name: "Unequip" }));
  act(() => fireEvent.click(screen.getByRole("button", { name: "Close inspector" })));
  act(() => fireEvent.click(slotOf("HAND_1")));
  fireEvent.click(screen.getByRole("button", { name: "Unequip" }));
  act(() => fireEvent.contextMenu(slotOf("HAND_1")));
  act(() => fireEvent.click(screen.getByRole("menuitem", { name: "Inspect" })));
  fireEvent.click(await screen.findByRole("button", { name: "Unequip" }));
  expect(equip).toHaveBeenCalledTimes(1);
  expect(equip.mock.calls[0]?.[0]).toEqual({ userItemId: katana.id, slot: "HAND_1" });
  expect(inspectorEquip).not.toHaveBeenCalled();
});

it("keeps an inspector equip guarded across backpack reopen and releases it when that equip settles", () => {
  useRealInspector();
  const { rerender } = renderWorkspace();
  act(() => fireEvent.click(card("Raijin Tanto")));
  fireEvent.click(screen.getByRole("button", { name: "Equip" }));
  act(() => fireEvent.click(screen.getByRole("button", { name: "← Back" })));
  act(() => fireEvent.click(card("Raijin Tanto")));
  fireEvent.click(screen.getByRole("button", { name: "Equip" }));
  expect(equip).toHaveBeenCalledTimes(1);
  expect(equip.mock.calls[0]?.[0]).toEqual({ userItemId: tanto.id });
  expect(inspectorEquip).not.toHaveBeenCalled();
  isEquipping = true;
  rerender({});
  expect(screen.queryByRole("button", { name: "Equip" })).toBeNull();
  act(() => equip.mock.calls[0]?.[1]?.onSettled?.());
  isEquipping = false;
  rerender({});
  expect(document.querySelector("[data-items-panel]")).toBeNull();
  act(() => fireEvent.click(card("Raijin Tanto")));
  fireEvent.click(screen.getByRole("button", { name: "Equip" }));
  expect(equip).toHaveBeenCalledTimes(2);
});
