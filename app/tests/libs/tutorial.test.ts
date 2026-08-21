import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findFirstHighlightableId,
  getTutorialStepPath,
  getTutorialHighlightedQuestId,
  getTutorialTakeQuestId,
  isTutorialGlobalMapStep,
  isTutorialItemBuyStep,
  isTutorialJutsuPickStep,
  isTutorialPageMatch,
  isUsableHighlightRect,
  TUTORIAL_HOME_SECTOR,
  TUTORIAL_ITEM_BUY_STEP_ID,
  TUTORIAL_JUTSU_PICK_STEP_ID,
} from "@/libs/tutorial";
import { WORLD_LANDMARKS } from "@/libs/sector-map/landmarks";

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

describe("isTutorialGlobalMapStep", () => {
  it("detects steps that should open the world map", () => {
    expect(
      isTutorialGlobalMapStep({
        elementIds: ["tutorial-global-map", "tutorial-Global"],
      }),
    ).toBe(true);
    expect(isTutorialGlobalMapStep({ elementIds: ["tutorial-travel-sector"] })).toBe(
      false,
    );
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

describe("findFirstHighlightableId", () => {
  it("skips missing and zero-size nodes so a closed modal does not win", () => {
    const rects: Record<string, { width: number; height: number } | null> = {
      "tutorial-global-travel-proceed": { width: 0, height: 0 },
      "tutorial-global-map": { width: 400, height: 400 },
      "tutorial-Global": { width: 48, height: 24 },
    };
    expect(
      findFirstHighlightableId(
        ["tutorial-global-travel-proceed", "tutorial-global-map", "tutorial-Global"],
        (id) => rects[id] ?? null,
      ),
    ).toBe("tutorial-global-map");
  });

  it("rejects unusable highlight rects", () => {
    expect(isUsableHighlightRect({ width: 0, height: 20 })).toBe(false);
    expect(isUsableHighlightRect({ width: 40, height: 20 })).toBe(true);
  });
});

describe("TUTORIAL_STEPS", () => {
  it("opens the world map before the Global tab so travel teaching is not stuck on sector view", () => {
    const tutorialPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../src/hooks/tutorial.tsx",
    );
    const source = readFileSync(tutorialPath, "utf8");
    const blocks = [
      ...source.matchAll(/elementIds:\s*\[([\s\S]*?)\]/g),
    ].map((match) => match[1]);
    const globalBlocks = blocks.filter((block) => block.includes("tutorial-global-map"));
    expect(globalBlocks.length).toBeGreaterThan(0);
    for (const block of globalBlocks) {
      expect(block.indexOf("tutorial-global-map")).toBeLessThan(
        block.indexOf("tutorial-Global"),
      );
    }
  });

  it("uses unique ids so findIndex cannot jump to an earlier step", () => {
    const tutorialPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../src/hooks/tutorial.tsx",
    );
    const source = readFileSync(tutorialPath, "utf8");
    const ids = [...source.matchAll(/^\s+id:\s+"([^"]+)"/gm)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(40);
    expect(ids).toHaveLength(new Set(ids).size);
  });
});
