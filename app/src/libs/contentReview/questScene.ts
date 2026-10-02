import { IMG_SCENE_BACKGROUND } from "@/drizzle/constants";

/** Scenes affected by a proposal, including objectives inheriting the quest scene. */
export const changedQuestScenes = (
  current: Record<string, unknown> | null,
  proposed: Record<string, unknown>,
) => {
  const before = contentOf(current);
  const after = contentOf(proposed);
  const hasQuestChange = sceneKey(before) !== sceneKey(after);
  const scenes: { label: string; objectiveIndex?: number }[] = [];
  if (hasQuestChange) scenes.push({ label: "Quest scene" });
  const oldObjectives = objectivesOf(before);
  const newObjectives = objectivesOf(after);
  for (
    let index = 0;
    index < Math.max(oldObjectives.length, newObjectives.length);
    index++
  ) {
    if (
      sceneKey(oldObjectives[index]) !== sceneKey(newObjectives[index]) ||
      (hasQuestChange &&
        (current?.consecutiveObjectives || proposed.consecutiveObjectives))
    ) {
      scenes.push({ label: `Objective ${index + 1}`, objectiveIndex: index });
    }
  }
  return scenes;
};

/** Same objective fallback and default background used by the quest dialog. */
export const questSceneOf = (
  fields: Record<string, unknown>,
  assets: Record<string, { image: string | null }>,
  objectiveIndex?: number,
) => {
  const content = contentOf(fields);
  const objective =
    objectiveIndex === undefined ? undefined : objectivesOf(content)[objectiveIndex];
  if (objectiveIndex !== undefined && !objective) return null;
  const backgroundId = objective?.sceneBackground || content.sceneBackground;
  const characterIds = objective?.sceneCharacters?.length
    ? objective.sceneCharacters
    : (content.sceneCharacters ?? []);
  const ids = [backgroundId, ...characterIds].filter((id): id is string => !!id);
  return {
    background: (backgroundId && assets[backgroundId]?.image) || IMG_SCENE_BACKGROUND,
    characters: characterIds.flatMap((id) =>
      assets[id]?.image ? [assets[id].image] : [],
    ),
    description:
      objective?.description ||
      (typeof fields.description === "string" ? fields.description : undefined),
    missing: ids.filter((id) => !assets[id]?.image),
  };
};

const contentOf = (fields: Record<string, unknown> | null) =>
  (fields?.content ?? {}) as SceneContent;
const objectivesOf = (content: SceneContent) => content.objectives ?? [];
const sceneKey = (scene: SceneContent | undefined) =>
  JSON.stringify([scene?.sceneBackground || "", scene?.sceneCharacters ?? []]);

type SceneContent = {
  sceneBackground?: string;
  sceneCharacters?: string[];
  description?: string;
  objectives?: SceneContent[];
};
