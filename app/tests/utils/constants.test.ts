import { describe, it, expect } from "vitest";
import {
  WAR_VILLAGE_MAX_SECTORS,
  WAR_FACTION_MAX_SECTORS,
  SHRINE_MAX_PER_VILLAGE,
} from "@/drizzle/constants";

describe("Sector and shrine limits", () => {
  it("should set village/faction sector caps to expected values", () => {
    expect(WAR_VILLAGE_MAX_SECTORS).toBe(9);
    expect(WAR_FACTION_MAX_SECTORS).toBe(6);
  });

  it("should keep shrine max per village at 4 (separate from sector caps)", () => {
    expect(SHRINE_MAX_PER_VILLAGE).toBe(4);
  });
});
