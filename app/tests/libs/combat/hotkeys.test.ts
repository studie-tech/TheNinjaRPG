import { describe, expect, it } from "bun:test";
import {
  assignHotkey,
  DEFAULT_BASIC_HOTKEYS,
  findLoadoutHotkeyConflict,
  type HotkeyMap,
  isBattleHotkeyBlocked,
  MAX_LOADOUT_HOTKEYS,
  resolveHotkeys,
  toHotkey,
} from "@/libs/combat/hotkeys";
import { hotkeyMapSchema } from "@/validators/loadout";

describe("battle hotkey focus", () => {
  it("leaves fields and Radix control typeahead to the focused control", () => {
    const controls = [
      "<input>",
      "<textarea></textarea>",
      "<select></select>",
      "<div contenteditable='true'><span></span></div>",
      "<button role='combobox'><span></span></button>",
      "<div role='listbox'><span></span></div>",
      "<div role='option'><span></span></div>",
      "<div role='menuitem'><span></span></div>",
    ];
    for (const markup of controls) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = markup;
      const target = wrapper.querySelector("span") ?? wrapper.firstElementChild!;
      const event = new window.KeyboardEvent("keydown", { key: "o", cancelable: true });
      target.dispatchEvent(event);
      expect(isBattleHotkeyBlocked(event)).toBe(true);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it("suspends battle keys for open dialogs, popovers and portalled select menus", () => {
    for (const role of ["dialog", "alertdialog", "listbox", "menu"]) {
      const overlay = document.createElement("div");
      overlay.setAttribute("role", role);
      overlay.dataset.state = "open";
      document.body.append(overlay);
      try {
        const event = new window.KeyboardEvent("keydown", { key: "o" });
        document.body.dispatchEvent(event);
        expect(isBattleHotkeyBlocked(event)).toBe(true);
        overlay.dataset.state = "closed";
        expect(isBattleHotkeyBlocked(event)).toBe(false);
      } finally {
        overlay.remove();
      }
    }
  });

  it("accepts ordinary battlefield keys and respects keys consumed by another handler", () => {
    const event = new window.KeyboardEvent("keydown", { key: "a", cancelable: true });
    document.body.dispatchEvent(event);
    expect(isBattleHotkeyBlocked(event)).toBe(false);
    event.preventDefault();
    expect(isBattleHotkeyBlocked(event)).toBe(true);
  });

  it("allows battle keys inside its dialog but suspends them for nested settings", () => {
    const battle = document.createElement("div");
    battle.setAttribute("role", "dialog");
    battle.setAttribute("data-battle-focus-dialog", "");
    document.body.append(battle);
    try {
      const event = new window.KeyboardEvent("keydown", { key: "a" });
      battle.dispatchEvent(event);
      expect(isBattleHotkeyBlocked(event)).toBe(false);
      const settings = document.createElement("div");
      settings.setAttribute("role", "dialog");
      battle.append(settings);
      expect(isBattleHotkeyBlocked(event)).toBe(true);
    } finally {
      battle.remove();
    }
  });
});

describe("battle hotkeys", () => {
  it("accepts letters, digits and the listed punctuation only", () => {
    expect(toHotkey("Q")).toBe("q");
    expect(toHotkey("7")).toBe("7");
    expect(toHotkey(";")).toBe(";");
    expect(toHotkey("Enter")).toBeUndefined();
    expect(toHotkey(" ")).toBeUndefined();
  });

  it("moves a key within a loadout and clears the default it replaces", () => {
    const { map, displaced } = assignHotkey(
      { jutsuA: "q" },
      "jutsuB",
      "a",
      DEFAULT_BASIC_HOTKEYS,
    );
    expect(map).toEqual({ jutsuA: "q", jutsuB: "a", basicAttack: "" });
    expect(displaced).toEqual(["basicAttack"]);
    const moved = assignHotkey(map, "jutsuC", "q", DEFAULT_BASIC_HOTKEYS);
    expect(moved.map).toEqual({ jutsuB: "a", basicAttack: "", jutsuC: "q" });
    expect(moved.displaced).toEqual(["jutsuA"]);
  });

  it("stores nothing when a basic goes back to its default", () => {
    const cleared = assignHotkey({}, "wait", "", DEFAULT_BASIC_HOTKEYS).map;
    expect(cleared).toEqual({ wait: "" });
    expect(assignHotkey(cleared, "wait", "w", DEFAULT_BASIC_HOTKEYS).map).toEqual({});
  });

  it("resolves defaults, then jutsu keys, then item keys without double use", () => {
    const { byAction, byKey } = resolveHotkeys(
      { wait: "", jutsuA: "1" },
      { potion: "1", scroll: "2" },
    );
    expect(byAction.wait).toBeUndefined();
    expect(byAction.move).toBe("m");
    expect(byKey["1"]).toBe("jutsuA");
    expect(byAction.potion).toBeUndefined();
    expect(byKey["2"]).toBe("scroll");
  });

  it("rejects unknown keys and oversized maps", () => {
    expect(hotkeyMapSchema.safeParse({ jutsuA: "q", wait: "" }).success).toBe(true);
    expect(hotkeyMapSchema.safeParse({ jutsuA: "Enter" }).success).toBe(false);
    const big = Object.fromEntries(
      Array.from({ length: MAX_LOADOUT_HOTKEYS + 1 }, (_, i) => [`j${i}`, "q"]),
    );
    expect(hotkeyMapSchema.safeParse(big).success).toBe(false);
  });

  it("checks every loadout of the other kind in both directions", () => {
    const loadouts: { name: string; hotkeys: HotkeyMap }[] = [
      { name: "", hotkeys: {} },
      { name: "Arena", hotkeys: { action: "q" } },
    ];
    expect(findLoadoutHotkeyConflict("jutsu", { jutsuA: "q" }, loadouts)).toEqual({
      key: "q",
      actionId: "action",
      loadoutName: 'item loadout "Arena"',
    });
    expect(findLoadoutHotkeyConflict("item", { potion: "q" }, loadouts)).toEqual({
      key: "q",
      actionId: "action",
      loadoutName: 'jutsu loadout "Arena"',
    });
    expect(
      findLoadoutHotkeyConflict("item", { potion: "2" }, loadouts),
    ).toBeUndefined();
    expect(
      findLoadoutHotkeyConflict("jutsu", { jutsuA: "" }, loadouts),
    ).toBeUndefined();
  });

  it("reserves defaults until every jutsu loadout clears or reassigns them", () => {
    const cleared = { name: "", hotkeys: { wait: "" } };
    expect(
      findLoadoutHotkeyConflict("item", { potion: "w" }, [cleared]),
    ).toBeUndefined();
    expect(
      findLoadoutHotkeyConflict("item", { potion: "w" }, [
        cleared,
        { name: "", hotkeys: null },
      ]),
    ).toMatchObject({
      key: "w",
      actionId: "wait",
      loadoutName: 'jutsu loadout "Loadout 2"',
    });
    expect(findLoadoutHotkeyConflict("item", { potion: "w" }, [])).toMatchObject({
      key: "w",
      actionId: "wait",
    });
    expect(
      findLoadoutHotkeyConflict("jutsu", {}, [{ name: "", hotkeys: { potion: "w" } }]),
    ).toMatchObject({ key: "w", actionId: "potion" });
    expect(
      findLoadoutHotkeyConflict("jutsu", { wait: "" }, [
        { name: "", hotkeys: { potion: "w" } },
      ]),
    ).toBeUndefined();
  });
});
