import { describe, expect, it } from "bun:test";
import { IMG_SCENE_BACKGROUND } from "@/drizzle/constants";
import { changedQuestScenes, questSceneOf } from "@/libs/contentReview/questScene";

const assets = {
  forest: { image: "forest.webp" },
  ninja: { image: "ninja.webp" },
};

describe("quest review scene composition", () => {
  it("ignores description-only changes", () => {
    expect(changedQuestScenes({ description: "Before" }, { description: "After" })).toEqual([]);
  });

  it("includes removed characters and nested objective changes", () => {
    expect(changedQuestScenes(
      { content: { objectives: [{ sceneCharacters: ["ninja"] }] } },
      { content: { objectives: [{ sceneCharacters: [] }] } },
    )).toEqual([{ label: "Objective 1", objectiveIndex: 0 }]);
  });

  it("previews objectives inheriting a changed quest background", () => {
    const current = { consecutiveObjectives: true, content: { objectives: [{}] } };
    const proposed = { ...current, content: { ...current.content, sceneBackground: "forest" } };
    expect(changedQuestScenes(current, proposed)).toEqual([
      { label: "Quest scene" }, { label: "Objective 1", objectiveIndex: 0 },
    ]);
  });

  it("uses quest-level fallbacks independently for empty objective fields", () => {
    expect(questSceneOf({ description: "Quest text", content: {
      sceneBackground: "forest", sceneCharacters: ["ninja"],
      objectives: [{ sceneBackground: "", sceneCharacters: [], description: "Objective text" }],
    } }, assets, 0)).toEqual({
      background: "forest.webp", characters: ["ninja.webp"], description: "Objective text", missing: [],
    });
  });

  it("reports missing assets and removed objectives without using IDs as URLs", () => {
    expect(questSceneOf({ content: { sceneBackground: "missing", sceneCharacters: ["missing"] } }, assets)).toEqual({
      background: IMG_SCENE_BACKGROUND, characters: [], description: undefined, missing: ["missing", "missing"],
    });
    expect(questSceneOf({ content: { objectives: [] } }, assets, 0)).toBeNull();
  });
});
