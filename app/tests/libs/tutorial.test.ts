import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getTutorialStepPath,
  isTutorialItemBuyStep,
  isTutorialJutsuPickStep,
  isTutorialPageMatch,
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

describe("TUTORIAL_STEPS", () => {
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
