/**
 * Database access for map asset; authorization and transaction scopes stay in callers.
 */
import { eq } from "drizzle-orm";
import { mapAsset } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";

/** COMMON QUERIES WHICH ARE REUSED */

/** Fetch a map asset row by id; undefined when it does not exist */
export const fetchMapAsset = async (client: DrizzleClient, id: string) => {
  return await client.query.mapAsset.findFirst({ where: eq(mapAsset.id, id) });
};

import { asc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { actionLog } from "@/drizzle/schema";

/** Build the `mapAsset` listing for `getAll`. */
export const listMapAssetForGetAll = (client: Pick<DrizzleClient, "query">) =>
  client.query.mapAsset.findMany({
    columns: { createdByUserId: false },
    orderBy: [asc(mapAsset.category), asc(mapAsset.key)],
  });

/** Build the `mapAsset` lookup for `get`, using predicates on `id`. */
export const findMapAssetForGet = (
  client: Pick<DrizzleClient, "query">,
  input: { id: string },
) =>
  client.query.mapAsset.findFirst({
    columns: { createdByUserId: false },
    where: eq(mapAsset.id, input.id),
  });

/** Build the `mapAsset` insert for `create`. */
export const insertMapAssetForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  input: { category: undefined | "structure" | "prop" } | undefined,
  ctx: { userId: string },
) =>
  client.insert(mapAsset).values({
    id,
    key: `new.asset.${id.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    name: input?.category === "structure" ? "New Structure" : "New Map Asset",
    category: input?.category ?? "prop",
    renderScale: input?.category === "structure" ? 2.4 : 1,
    imageUrl: IMG_AVATAR_DEFAULT,
    createdByUserId: ctx.userId,
  });

/** Build the `mapAsset` lookup for `update`, selecting only `id` and `key`, using predicates on `key`. */
export const findMapAssetForUpdate = (
  client: Pick<DrizzleClient, "query">,
  input: { data: { key: string } },
) =>
  client.query.mapAsset.findFirst({
    columns: { id: true, key: true },
    where: eq(mapAsset.key, input.data.key),
  });

/** Build the `mapAsset` update for `update`, setting `updatedAt`, using predicates on `id`. */
export const updateMapAssetForUpdate = (
  client: Pick<DrizzleClient, "update">,
  input: { data: import("@/validators/mapAsset").ZodMapAssetType },
  entry: { id: string },
) =>
  client
    .update(mapAsset)
    .set({ ...input.data, updatedAt: new Date() })
    .where(eq(mapAsset.id, entry.id));

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  entry: { id: string; name: string; imageUrl: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "mapAsset",
    changes: diff,
    relatedId: entry.id,
    relatedMsg: `Update: ${entry.name}`,
    relatedImage: entry.imageUrl,
  });

/** Build the `mapAsset` deletion for `delete`, using predicates on `id`. */
export const deleteMapAssetForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(mapAsset).where(eq(mapAsset.id, input.id));

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { name: string; key: string; id: string; imageUrl: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "mapAsset",
    changes: [`Deleted map asset ${entry.name} (${entry.key})`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.name}`,
    relatedImage: entry.imageUrl,
  });
