import { describe, expect, it } from "bun:test";
import { KESSEN_FACTION_INFO, kessenFactionPerk } from "@/layout/kessen/hub/hubData";
import { kessenNpc } from "@/libs/kessen/npcs";
import { DEFAULT_KNOBS } from "@/libs/kessen/rules";

describe("Kessen faction perks", () => {
  it("words each perk from the knobs a match plays with", () => {
    expect(KESSEN_FACTION_INFO.SHIROHANA.perkText).toContain(
      `+${DEFAULT_KNOBS.sunBonus} power`,
    );
    expect(KESSEN_FACTION_INFO.AKASUMI.perkText).toContain(
      `power ${DEFAULT_KNOBS.tideMaxPower} or less`,
    );
    expect(
      kessenFactionPerk("SHIROHANA", { ...DEFAULT_KNOBS, sunBonus: 3 })?.perkText,
    ).toContain("+3 power");
  });

  it("names no perk the knobs switch off", () => {
    expect(KESSEN_FACTION_INFO.TSUKIMORI.perk).toBe(
      DEFAULT_KNOBS.evergreen ? "Evergreen" : null,
    );
    expect(
      kessenFactionPerk("TSUKIMORI", { ...DEFAULT_KNOBS, evergreen: true }),
    ).toEqual({
      perk: "Evergreen",
      perkText: "Your last-placed unit stays on the board into the next round.",
    });
    expect(kessenFactionPerk("AKASUMI", { ...DEFAULT_KNOBS, tideCount: 0 })).toBeNull();
  });

  it("names Evergreen in Blood Moon only while it is on", () => {
    const text = kessenNpc("junko")?.ascended?.houseRule?.text ?? "";
    expect(text.includes("Evergreen")).toBe(DEFAULT_KNOBS.evergreen);
  });
});
