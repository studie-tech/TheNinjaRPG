import type { Item } from "@/drizzle/schema";
import { selectItemDefinitions } from "@/queries/item";
import { createDefinitionCache } from "@/server/utils/caches/definitionCache";

/** Item definitions shared by profile and inventory reads. */
export const itemDefinitions = createDefinitionCache<Item>({
  name: "item-definitions",
  memoryLimit: 2000,
  select: (client, ids) => selectItemDefinitions(client, ids),
});
