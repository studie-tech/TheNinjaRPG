import type { Jutsu } from "@/drizzle/schema";
import { selectJutsuDefinitions } from "@/queries/jutsu";
import { createDefinitionCache } from "@/server/utils/caches/definitionCache";

/** Jutsu definitions of jutsu list reads. */
export const jutsuDefinitions = createDefinitionCache<Jutsu>({
  name: "jutsu-definitions",
  memoryLimit: 4000,
  select: (client, ids) => selectJutsuDefinitions(client, ids),
});
