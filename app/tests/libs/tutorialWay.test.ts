import { describe, expect, it } from "bun:test";
import { TUTORIAL_ANY_PAGE, TUTORIAL_WAKE_SECTOR } from "@/libs/tutorial";
import { TUTORIAL_STEPS } from "@/libs/tutorialSteps";
import { getTutorialWay } from "@/libs/tutorialWay";

const HOME = 301;
const way = (page: string, patch: Partial<Parameters<typeof getTutorialWay>[0]> = {}) =>
  getTutorialWay({
    page,
    pathname: "/profile",
    sector: HOME,
    village: { name: "Horizon", sector: HOME },
    hasUnassignedExperience: false,
    ...patch,
  });

describe("getTutorialWay", () => {
  it("leads into the village and then to the building", () => {
    expect(way("/academy")).toMatchObject({
      elementIds: ["tutorial-village"],
      action: "Tap Horizon in the location menu.",
      isInGameMenu: true,
    });
    expect(way("/academy", { pathname: "/village" })).toMatchObject({
      elementIds: ["tutorial-academy"],
      action: "Tap Academy.",
      isInGameMenu: false,
    });
    expect(way("/academy", { pathname: "/academy" })).toBeUndefined();
  });

  it("leads home over the map first from another sector", () => {
    const away = { sector: 222 };
    expect(way("/academy", away)?.elementIds).toEqual(["tutorial-travel"]);
    expect(way("/academy", { ...away, pathname: "/travel" })).toMatchObject({
      elementIds: ["tutorial-Global"],
      action: "Travel to Horizon on the Global map.",
    });
    // Another place's village page is not the one the lesson needs.
    expect(way("/village", { ...away, pathname: "/village" })?.elementIds).toEqual([
      "tutorial-travel",
    ]);
    expect(way("/village", { pathname: "/village" })).toBeUndefined();
  });

  it("leads to the sanctuary on Wake Island", () => {
    const wake = { sector: TUTORIAL_WAKE_SECTOR };
    expect(way("/pets", wake)?.action).toBe("Tap Wake Island in the location menu.");
    expect(way("/pets")?.elementIds).toEqual(["tutorial-travel"]);
    expect(
      way("/village", { ...wake, arrivesAt: "/pets", pathname: "/village" }),
    ).toBeUndefined();
  });

  it("finds experience to spend, then the level it earned", () => {
    expect(
      way("/profile/experience", { hasUnassignedExperience: true })?.elementIds,
    ).toEqual(["tutorial-unassigned-stats"]);
    expect(way("/profile/experience")?.elementIds[0]).toBe("tutorial-level-up-btn");
    expect(way("/profile/experience", { pathname: "/village" })?.elementIds).toEqual([
      "tutorial-profile",
    ]);
  });

  it("knows a way to every lesson's page", () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.page === TUTORIAL_ANY_PAGE || step.page === "/combat") continue;
      expect(
        way(step.page, { pathname: "/inbox", arrivesAt: step.arrivesAt }),
        step.id,
      ).toBeTruthy();
    }
  });
});
