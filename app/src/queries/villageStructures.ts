import { eq, inArray, sql } from "drizzle-orm";
import type { VillageStructureInsert } from "@/drizzle/schema";
import { village, villageStructure } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** Resolve published settlement names to this database's village IDs. */
export const selectVillagesForStructureSeed = (
  client: DrizzleClient,
  names: string[],
) =>
  client.query.village.findMany({
    columns: { id: true, name: true },
    where: inArray(village.name, names),
  });

/** Load existing structures without a dependent query for local village IDs. */
export const selectStructuresForSeed = (client: DrizzleClient, names: string[]) =>
  client
    .select({ structure: villageStructure })
    .from(villageStructure)
    .innerJoin(village, eq(village.id, villageStructure.villageId))
    .where(inArray(village.name, names));

/** Batch published presentation without changing local IDs, levels, health or bonuses. */
export const upsertStructuresForSeed = (
  client: DrizzleClient,
  rows: (StructurePresentation & { id: string; villageId: string })[],
) =>
  client
    .insert(villageStructure)
    .values(rows)
    .onDuplicateKeyUpdate({
      set: {
        name: sql`VALUES(name)`,
        route: sql`VALUES(route)`,
        image: sql`VALUES(image)`,
        worldArt: sql`VALUES(worldArt)`,
        longitude: sql`VALUES(longitude)`,
        latitude: sql`VALUES(latitude)`,
        hasPage: sql`VALUES(hasPage)`,
        allyAccess: sql`VALUES(allyAccess)`,
        showInVillagePage: sql`VALUES(showInVillagePage)`,
      },
    });

export type StructurePresentation = Pick<
  VillageStructureInsert,
  | "name"
  | "route"
  | "image"
  | "worldArt"
  | "longitude"
  | "latitude"
  | "hasPage"
  | "allyAccess"
  | "showInVillagePage"
>;
