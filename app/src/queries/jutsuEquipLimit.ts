import { eq } from "drizzle-orm";
import { jutsuEquipLimit } from "@/drizzle/schema";
import { buildJutsuEquipCaps } from "@/libs/jutsu";
import type { DrizzleClient } from "@/server/db";
import type { JutsuEquipLimit } from "@/validators/jutsuEquipLimit";

/** Load staff-configured equip limits for both modes. */
export const fetchJutsuEquipLimits = (client: DrizzleClient) =>
  client.select().from(jutsuEquipLimit).orderBy(jutsuEquipLimit.category);
/** Resolve limits for one equipment validation operation. */
export const fetchJutsuEquipCaps = async (
  client: DrizzleClient,
  mode: "ranked" | "unranked" = "unranked",
) => buildJutsuEquipCaps(await fetchJutsuEquipLimits(client), mode);
/** Atomically save both mode limits for one category. */
export const saveJutsuEquipLimit = (client: DrizzleClient, input: JutsuEquipLimit) =>
  client
    .insert(jutsuEquipLimit)
    .values(input)
    .onDuplicateKeyUpdate({
      set: {
        unrankedMaxEquipped: input.unrankedMaxEquipped,
        rankedMaxEquipped: input.rankedMaxEquipped,
      },
    });
/** Remove the category restriction in both modes. */
export const deleteJutsuEquipLimit = (client: DrizzleClient, category: string) =>
  client.delete(jutsuEquipLimit).where(eq(jutsuEquipLimit.category, category));
