import { describe, expect, it } from "bun:test";
import { LOADOUT_NAME_MAX_LENGTH } from "@/drizzle/constants";
import { exportJutsuLoadout } from "@/libs/loadout";
import {
  LOADOUT_SHARE_MAX_ENTRIES,
  LOADOUT_SHARE_MAX_LENGTH,
  renameLoadoutSchema,
  sharedJutsuLoadoutTextSchema,
} from "@/validators/loadout";

describe("renameLoadoutSchema", () => {
  it("accepts a normal name", () => {
    const r = renameLoadoutSchema.safeParse({ id: "l1", name: "PvP" });
    expect(r.success).toBe(true);
  });
  it("trims and accepts", () => {
    const r = renameLoadoutSchema.safeParse({ id: "l1", name: "  Farming  " });
    expect(r.success && r.data.name).toBe("Farming");
  });
  it("rejects an empty name", () => {
    expect(renameLoadoutSchema.safeParse({ id: "l1", name: "   " }).success).toBe(
      false,
    );
  });
  it("rejects an over-long name", () => {
    const long = "x".repeat(LOADOUT_NAME_MAX_LENGTH + 1);
    expect(renameLoadoutSchema.safeParse({ id: "l1", name: long }).success).toBe(false);
  });
});

describe("shared jutsu loadout format", () => {
  it("round trips only the format and ordered jutsu IDs", () => {
    const text = exportJutsuLoadout(["third", "first", "second"]);
    expect(JSON.parse(text)).toEqual({
      type: "tnr-jutsu-loadout",
      version: 1,
      jutsuIds: ["third", "first", "second"],
    });
    expect(sharedJutsuLoadoutTextSchema.parse(text).jutsuIds).toEqual([
      "third",
      "first",
      "second",
    ]);
  });

  it("normalizes duplicates without changing their first position", () => {
    const text = JSON.stringify({
      type: "tnr-jutsu-loadout",
      version: 1,
      jutsuIds: ["b", "a", "b", "c", "a"],
    });
    expect(sharedJutsuLoadoutTextSchema.parse(text).jutsuIds).toEqual(["b", "a", "c"]);
  });

  it.each([
    "",
    "not JSON",
    "null",
    "[]",
    "{}",
    JSON.stringify({ type: "ranked-loadout", version: 1, jutsuIds: [] }),
    JSON.stringify({ type: "tnr-jutsu-loadout", version: 2, jutsuIds: [] }),
    JSON.stringify({ type: "tnr-jutsu-loadout", version: 1, jutsuIds: [""] }),
    JSON.stringify({
      type: "tnr-jutsu-loadout",
      version: 1,
      jutsuIds: ["x".repeat(192)],
    }),
    JSON.stringify({ type: "tnr-jutsu-loadout", version: 1, jutsuIds: [42] }),
    JSON.stringify({
      type: "tnr-jutsu-loadout",
      version: 1,
      jutsuIds: [],
      userId: "sender",
    }),
    JSON.stringify({
      type: "tnr-jutsu-loadout",
      version: 1,
      jutsuIds: Array(LOADOUT_SHARE_MAX_ENTRIES + 1).fill("a"),
    }),
    " ".repeat(LOADOUT_SHARE_MAX_LENGTH + 1),
  ])("rejects invalid or unsupported input %#", (text) => {
    expect(sharedJutsuLoadoutTextSchema.safeParse(text).success).toBe(false);
  });
});
