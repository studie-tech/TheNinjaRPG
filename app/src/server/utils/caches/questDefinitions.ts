import type { Quest } from "@/drizzle/schema";
import { selectQuestRevisionDefinitions } from "@/queries/questRevisions";
import { createDefinitionCache } from "@/server/utils/caches/definitionCache";

/** Revision-keyed quest definitions for profile, discovery and history reads. */
export const questDefinitions = createDefinitionCache<Quest>({
  name: "quest-definitions",
  memoryLimit: 1000,
  select: (client, ids) => selectQuestRevisionDefinitions(client, ids),
});
