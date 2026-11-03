import { IMG_SCENE_BACKGROUND } from "@/drizzle/constants";

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

type SceneContent = {
  sceneBackground?: string;
  sceneCharacters?: string[];
  description?: string;
  objectives?: SceneContent[];
};
