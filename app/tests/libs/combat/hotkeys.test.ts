import { describe, expect, it } from "bun:test";
import {
  assignHotkey,
  DEFAULT_BASIC_HOTKEYS,
  hotkeyMapSchema,
  MAX_LOADOUT_HOTKEYS,
  resolveHotkeys,
  toHotkey,
} from "@/libs/combat/hotkeys";

describe("battle hotkeys", () => {
  it("accepts letters, digits and the listed punctuation only", () => {
    expect(toHotkey("Q")).toBe("q");
    expect(toHotkey("7")).toBe("7");
    expect(toHotkey(";")).toBe(";");
    expect(toHotkey("Enter")).toBeUndefined();
    expect(toHotkey(" ")).toBeUndefined();
  });

  it("moves a key within a loadout and clears the default it replaces", () => {
    const { map, displaced } = assignHotkey({ jutsuA: "q" }, "jutsuB", "a", DEFAULT_BASIC_HOTKEYS);
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
});
