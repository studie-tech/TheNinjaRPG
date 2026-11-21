import type { VillageStructure } from "@/drizzle/schema";
import { selectStructureDefinitions } from "@/queries/profile";
import { createDefinitionCache } from "@/server/utils/caches/definitionCache";

/**
 * Village structure rows shared by profile and sector reads. Rows change with upgrades
 * and raids; each change is one read per village.
 */
export const structureDefinitions = createDefinitionCache<VillageStructure>({
  name: "structure-definitions",
  memoryLimit: 1000,
  select: (client, ids) => selectStructureDefinitions(client, ids),
});
