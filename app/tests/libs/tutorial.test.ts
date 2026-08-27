import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TUTORIAL_STEPS_COUNT } from "@/drizzle/constants";
import { WORLD_LANDMARKS } from "@/libs/sector-map/landmarks";
import {
  getTutorialHighlightedQuestId,
  getTutorialStepPath,
  getTutorialTakeQuestId,
  isTutorialItemBuyStep,
  isTutorialJutsuPickStep,
  isTutorialPageMatch,
  isTutorialActive,
  isUsableHighlightRect,
  TUTORIAL_HOME_SECTOR,
  TUTORIAL_ITEM_BUY_STEP_ID,
  TUTORIAL_JUTSU_PICK_STEP_ID,
} from "@/libs/tutorial";

/**
 * TUTORIAL_STEPS lives in a client module that pulls in tRPC, jotai and
 * next/navigation, so it cannot be imported here. Read the source instead and
 * slice it to the array, so `id:` keys elsewhere in the file cannot leak in.
 */
const readTutorialStepsSource = () => {
  const tutorialPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../src/hooks/tutorial.tsx",
  );
  const source = readFileSync(tutorialPath, "utf8");
  const start = source.indexOf("export const TUTORIAL_STEPS");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n];", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

const stepIds = () =>
  [...readTutorialStepsSource().matchAll(/^ {4}id: "([^"]+)"/gm)].map(
    (match) => match[1],
  );

const elementIdBlocks = () =>
  [...readTutorialStepsSource().matchAll(/elementIds:\s*\[([\s\S]*?)\]/g)].map(
    (match) => match[1] ?? "",
  );

describe("getTutorialStepPath", () => {
  it("strips in-page hashes", () => {
    expect(getTutorialStepPath("/townhall#Kage")).toBe("/townhall");
  });

  it("returns empty string for missing pages", () => {
    expect(getTutorialStepPath()).toBe("");
  });
});

describe("isTutorialPageMatch", () => {
  it("matches the exact pathname", () => {
    expect(isTutorialPageMatch("/profile", "/profile")).toBe(true);
  });

  it("does not treat /profile as a prefix of /profile/experience", () => {
    expect(isTutorialPageMatch("/profile/experience", "/profile")).toBe(false);
    expect(isTutorialPageMatch("/profile", "/profile/experience")).toBe(false);
  });

  it("matches hashed tab steps against the base route", () => {
    expect(isTutorialPageMatch("/blackmarket#Ryo", "/blackmarket")).toBe(true);
  });
});

describe("isTutorialJutsuPickStep", () => {
  it("identifies the jutsu-pick step by id", () => {
    expect(isTutorialJutsuPickStep({ id: TUTORIAL_JUTSU_PICK_STEP_ID })).toBe(true);
    expect(isTutorialJutsuPickStep({ id: "other" })).toBe(false);
  });
});

describe("isTutorialItemBuyStep", () => {
  it("identifies the shuriken purchase step by id", () => {
    expect(isTutorialItemBuyStep({ id: TUTORIAL_ITEM_BUY_STEP_ID })).toBe(true);
    expect(isTutorialItemBuyStep({ id: TUTORIAL_JUTSU_PICK_STEP_ID })).toBe(false);
  });
});

describe("TUTORIAL_HOME_SECTOR", () => {
  it("tracks the current Horizon landmark, not the remapped 296 sector", () => {
    const horizon = WORLD_LANDMARKS.find((landmark) => landmark.name === "Horizon");
    expect(horizon?.sector).toBe(TUTORIAL_HOME_SECTOR);
    expect(TUTORIAL_HOME_SECTOR).not.toBe(296);
  });
});

describe("getTutorialTakeQuestId", () => {
  it("reads the quest id from a take-quest highlight", () => {
    expect(
      getTutorialTakeQuestId({
        elementIds: ["logbook-entry-abc", "tutorial-take-quest-quest-99"],
      }),
    ).toBe("quest-99");
  });
});

describe("getTutorialHighlightedQuestId", () => {
  it("prefers the take-quest button id, then related academy quests", () => {
    expect(
      getTutorialHighlightedQuestId({
        title: "Genin Exam",
        relatedValue: "fallback",
        elementIds: ["tutorial-take-quest-exam-1"],
      }),
    ).toBe("exam-1");
    expect(
      getTutorialHighlightedQuestId({
        title: "Genin Exam",
        relatedValue: "exam-2",
      }),
    ).toBe("exam-2");
  });
});

describe("isTutorialActive", () => {
  it("is active for a freshly registered account", () => {
    // Schema defaults for a new UserData row
    expect(isTutorialActive({ tutorialOn: true, tutorialStep: 0 })).toBe(true);
  });

  it("is inactive once the tutorial is switched off or finished", () => {
    expect(isTutorialActive({ tutorialOn: false, tutorialStep: 0 })).toBe(false);
    expect(
      isTutorialActive({ tutorialOn: true, tutorialStep: TUTORIAL_STEPS_COUNT }),
    ).toBe(false);
  });

  it("is inactive without a user", () => {
    expect(isTutorialActive(undefined)).toBe(false);
    expect(isTutorialActive(null)).toBe(false);
  });
});

describe("isUsableHighlightRect", () => {
  it("rejects unusable highlight rects", () => {
    expect(isUsableHighlightRect({ width: 0, height: 20 })).toBe(false);
    expect(isUsableHighlightRect({ width: 40, height: 20 })).toBe(true);
  });
});

describe("TUTORIAL_STEPS", () => {
  it("highlights the world-travel confirm button before the globe and the Global tab", () => {
    const globalBlocks = elementIdBlocks().filter((block) =>
      block.includes("tutorial-global-map"),
    );
    expect(globalBlocks.length).toBeGreaterThan(0);
    for (const block of globalBlocks) {
      // Once the travel modal opens its proceed button must win the highlight;
      // the always-mounted globe would otherwise keep it for the whole step.
      expect(block.indexOf("tutorial-global-travel-proceed")).toBeLessThan(
        block.indexOf("tutorial-global-map"),
      );
      expect(block.indexOf("tutorial-global-map")).toBeLessThan(
        block.indexOf("tutorial-Global"),
      );
    }
  });

  it("uses unique ids so findIndex cannot jump to an earlier step", () => {
    const ids = stepIds();
    expect(ids.length).toBe(TUTORIAL_STEPS_COUNT);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it("keeps the pinned-step constants pointing at real steps", () => {
    const ids = stepIds();
    expect(ids).toContain(TUTORIAL_JUTSU_PICK_STEP_ID);
    expect(ids).toContain(TUTORIAL_ITEM_BUY_STEP_ID);
  });

  it("gives every single-action step a Next button so it cannot dead-end", () => {
    // Enter/ArrowRight only advance when a step declares showNextButton or
    // proceedOnHighlightClick, so a step whose only other exit is one specific
    // game action needs an explicit escape hatch.
    const source = readTutorialStepsSource();
    for (const stepId of [
      TUTORIAL_JUTSU_PICK_STEP_ID,
      TUTORIAL_ITEM_BUY_STEP_ID,
      // Genin Exam - the final step, only otherwise exited by taking the quest
      "qgfxpmmQ2mYayeN2iMuX6",
    ]) {
      const start = source.indexOf(`id: "${stepId}"`);
      expect(start).toBeGreaterThan(-1);
      const block = source.slice(start, source.indexOf("\n  },", start));
      expect(block).toContain("showNextButton: true");
    }
  });
});
