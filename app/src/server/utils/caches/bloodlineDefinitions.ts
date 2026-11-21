import type { Bloodline } from "@/drizzle/schema";
import { selectBloodlineDefinitions } from "@/queries/jutsu";
import { createDefinitionCache } from "@/server/utils/caches/definitionCache";

/** Bloodline definitions attached to bloodline jutsu in jutsu list reads. */
export const bloodlineDefinitions = createDefinitionCache<Bloodline>({
  name: "bloodline-definitions",
  memoryLimit: 1000,
  select: (client, ids) => selectBloodlineDefinitions(client, ids),
});
