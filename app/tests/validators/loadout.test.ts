import { describe, it, expect } from "vitest";
import { renameLoadoutSchema } from "@/validators/loadout";
import { LOADOUT_NAME_MAX_LENGTH } from "@/drizzle/constants";

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
    expect(renameLoadoutSchema.safeParse({ id: "l1", name: "   " }).success).toBe(false);
  });
  it("rejects an over-long name", () => {
    const long = "x".repeat(LOADOUT_NAME_MAX_LENGTH + 1);
    expect(renameLoadoutSchema.safeParse({ id: "l1", name: long }).success).toBe(false);
  });
});
