import { describe, expect, it } from "bun:test";
import { resolveRememberedTab } from "@/layout/NavTabs";
import {
  getJutsuStatQuickFilter,
  getTrainingSections,
  jutsuStatQuickFilterSelection,
  jutsuStatQuickFilters,
} from "@/libs/train";

describe("training grounds sections", () => {
  it("merges covert training and the sensei system into one section", () => {
    expect(getTrainingSections(true).options).toEqual([
      "Stats",
      "Masteries",
      "Jutsu",
      "Covert & Sensei",
    ]);
    expect(getTrainingSections(false).options).toEqual([
      "Stats",
      "Masteries",
      "Jutsu",
      "Covert",
    ]);
  });

  it.each([
    ["Covert", true, "Covert & Sensei"],
    ["Sensei", true, "Covert & Sensei"],
    ["Covert & Sensei", true, "Covert & Sensei"],
    ["Covert", false, "Covert"],
    ["Sensei", false, "Covert"],
    ["Covert & Sensei", false, "Covert"],
    ["Masteries", true, "Masteries"],
    ["Removed", true, "Stats"],
  ])("reopens a saved %s section (sensei eligible: %s) as %s", (stored, eligible, tab) => {
    const { options, aliases } = getTrainingSections(eligible);
    expect(resolveRememberedTab(stored, options, aliases)).toBe(tab);
  });
});

describe("jutsu stat quick filters", () => {
  it("offers the stats a jutsu can scale with", () => {
    expect(jutsuStatQuickFilters).toEqual([
      "All",
      "Ninjutsu",
      "Genjutsu",
      "Taijutsu",
      "Bukijutsu",
      "Highest",
    ]);
  });

  it("round-trips every quick filter through the stat selection", () => {
    for (const option of jutsuStatQuickFilters) {
      expect(getJutsuStatQuickFilter(jutsuStatQuickFilterSelection(option))).toBe(option);
    }
    expect(jutsuStatQuickFilterSelection("All")).toEqual([]);
    expect(jutsuStatQuickFilterSelection("Highest")).toEqual(["Highest"]);
  });

  it("leaves no quick filter active for custom stat selections", () => {
    expect(getJutsuStatQuickFilter(undefined)).toBe("All");
    expect(getJutsuStatQuickFilter(["Strength"])).toBeNull();
    expect(getJutsuStatQuickFilter(["Ninjutsu", "Genjutsu"])).toBeNull();
  });
});
