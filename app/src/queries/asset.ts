/**
 * Asset database access; callers own authorization and mutation orchestration.
 */
import type { SQL } from "drizzle-orm";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  getTableColumns,
  inArray,
  like,
  ne,
  notExists,
  sql,
} from "drizzle-orm";
import { nanoid } from "nanoid";
import type { GameAssetType } from "@/drizzle/constants";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import {
  actionLog,
  contentTag,
  gameAsset,
  gameAssetTag,
  item,
  itemVariant,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type { ZodGameAssetType } from "@/validators/asset";

/** Load a game asset by ID; no match yields undefined. */
export const fetchGameAsset = async (client: DrizzleClient, id: string) => {
  return await client.query.gameAsset.findFirst({
    where: eq(gameAsset.id, id),
  });
};

/** Load complete LPC designs once for a scene; hidden designs still resolve saved references. */
export const listLpcAssets = (client: Pick<DrizzleClient, "query">) =>
  client.query.gameAsset.findMany({
    columns: { id: true, name: true, hidden: true, lpcConfig: true },
    where: eq(gameAsset.type, "LPC"),
  });

/** Insert immutable catalog seeds without overwriting staff-authored changes. */
export const insertLpcSeedAsset = (
  client: Pick<DrizzleClient, "insert">,
  asset: typeof gameAsset.$inferInsert,
) =>
  client
    .insert(gameAsset)
    .values(asset)
    .onDuplicateKeyUpdate({ set: { id: sql`${gameAsset.id}` } });

/**
 * Check item and variant assignments within the deletion statement.
 * Callers require rowsAffected before recording a successful deletion.
 */
export const deleteUnreferencedLpcAsset = (client: DrizzleClient, id: string) =>
  client
    .delete(gameAsset)
    .where(
      and(
        eq(gameAsset.id, id),
        notExists(
          client.select({ id: item.id }).from(item).where(eq(item.lpcProfile, id)),
        ),
        notExists(
          client
            .select({ id: itemVariant.id })
            .from(itemVariant)
            .where(eq(itemVariant.lpcProfile, id)),
        ),
      ),
    );

/** Build the `gameAsset` listing for `getNameTags`, selecting only `name`, using the configured predicates. */
export const listGameAssetForGetNameTags = (
  client: Pick<DrizzleClient, "query">,
  whereClauses: SQL<unknown>[],
) =>
  client.query.gameAsset.findMany({
    columns: { name: true },
    where: and(...whereClauses),
  });

/** Build the `gameAsset` listing for `getAllNames`, using predicates on `type`. */
export const listGameAssetForGetAllNames = (
  client: Pick<DrizzleClient, "query">,
  input: {
    type?: GameAssetType | undefined;
  },
) =>
  client.query.gameAsset.findMany({
    columns: { id: true, name: true, image: true, folder: true },
    where: input.type ? eq(gameAsset.type, input.type) : ne(gameAsset.type, "LPC"),
  });

/** List content tags assigned to assets for public tag discovery. */
export const selectDistinctGameAssetTagForGetAllGameAssetContentTagNames = (
  client: Pick<DrizzleClient, "selectDistinct">,
) =>
  client
    .selectDistinct({ name: contentTag.name })
    .from(gameAssetTag)
    .innerJoin(contentTag, eq(gameAssetTag.tagId, contentTag.id));

/** Count all nonempty folders, optionally within one media type, without pagination. */
export const selectGameAssetForGetAllFolders = (
  client: Pick<DrizzleClient, "select">,
  input?: { type?: GameAssetType },
) =>
  client
    .select({
      folder: gameAsset.folder,
      count: count(),
    })
    .from(gameAsset)
    .where(
      and(
        ne(gameAsset.folder, sql`''`),
        input?.type ? eq(gameAsset.type, input.type) : undefined,
      ),
    )
    .groupBy(gameAsset.folder)
    .orderBy(gameAsset.folder);

/**
 * Build a deterministically ordered listing, retaining animation-free picker defaults.
 * `folder` matches substrings; `exactFolder` also accepts an empty Unfiled folder.
 * Callers can opt into animations and request an extra row for pagination lookahead.
 */
export const selectGameAssetForGetAll = (
  client: Pick<DrizzleClient, "select">,
  input: {
    name?: undefined | string;
    type?: GameAssetType | undefined;
    tags?: string[];
    nameTokens?: undefined | string[];
    folder?: undefined | string;
    includeAnimations?: boolean;
    exactFolder?: string;
    sort?: "newest" | "oldest" | "name-asc" | "name-desc";
  },
  limit: number,
  skip: number,
) =>
  client
    .select({ ...getTableColumns(gameAsset) })
    .from(gameAsset)
    .where(
      and(
        ...(input.name ? [like(gameAsset.name, `%${input.name}%`)] : []),
        ...(input.type
          ? [eq(gameAsset.type, input.type)]
          : input.includeAnimations
            ? []
            : [ne(gameAsset.type, "ANIMATION"), ne(gameAsset.type, "LPC")]),
        // A matching tag qualifies an asset once, even when several selected tags match.
        input.tags
          ? exists(
              client
                .select({ id: gameAssetTag.id })
                .from(gameAssetTag)
                .innerJoin(contentTag, eq(gameAssetTag.tagId, contentTag.id))
                .where(
                  and(
                    eq(gameAssetTag.assetId, gameAsset.id),
                    inArray(contentTag.name, input.tags),
                  ),
                ),
            )
          : undefined,
        ...(input.nameTokens
          ? input.nameTokens.map((t) => like(gameAsset.name, `%${t}%`))
          : []),
        ...(input.folder ? [like(gameAsset.folder, `%${input.folder}%`)] : []),
        ...(input.exactFolder !== undefined
          ? [eq(gameAsset.folder, input.exactFolder)]
          : []),
      ),
    )
    .orderBy(
      input.sort === "newest"
        ? desc(gameAsset.createdAt)
        : input.sort === "oldest"
          ? asc(gameAsset.createdAt)
          : input.sort === "name-asc"
            ? asc(gameAsset.name)
            : desc(gameAsset.name),
      asc(gameAsset.id),
    )
    .limit(limit)
    .offset(skip);

/** Build the `gameAsset` listing for `getSceneAssets`, using predicates on `id`. */
export const listGameAssetForGetSceneAssets = (
  client: Pick<DrizzleClient, "query">,
  input: { assetIds: string[] },
) =>
  client.query.gameAsset.findMany({
    where: inArray(gameAsset.id, input.assetIds),
  });

/** Build the `gameAsset` update for `update`, using predicates on `id`. */
export const updateGameAssetForUpdate = (
  client: Pick<DrizzleClient, "update">,
  input: { data: ZodGameAssetType },
  entry: { id: string },
) =>
  client
    .update(gameAsset)
    .set({ ...input.data, updatedAt: new Date() })
    .where(eq(gameAsset.id, entry.id));

/** Build the `actionLog` insert for `update`. */
export const insertActionLogForUpdate = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  diff: string[],
  entry: { id: string; name: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "gameAsset",
    changes: diff,
    relatedId: entry.id,
    relatedMsg: `Update: ${entry.name}`,
    relatedImage: entry.image,
  });

/** Build one asset insert; omitted metadata retains placeholder defaults for callers. */
export const insertGameAssetForCreate = (
  client: Pick<DrizzleClient, "insert">,
  id: string,
  ctx: { userId: string },
  input?: { name: string; type: GameAssetType; folder?: string },
) =>
  client.insert(gameAsset).values({
    id: id,
    name: input?.name ?? "Placeholder",
    type: input?.type ?? "STATIC",
    folder: input?.folder ?? "",
    image: IMG_AVATAR_DEFAULT,
    url: IMG_AVATAR_DEFAULT,
    createdByUserId: ctx.userId,
  });

/** Build the `gameAsset` deletion for `delete`, using predicates on `id`. */
export const deleteGameAssetForDelete = (
  client: Pick<DrizzleClient, "delete">,
  input: { id: string },
) => client.delete(gameAsset).where(eq(gameAsset.id, input.id));

/** Build the `actionLog` insert for `delete`. */
export const insertActionLogForDelete = (
  client: Pick<DrizzleClient, "insert">,
  ctx: { userId: string },
  entry: { name: string; id: string; image: string },
) =>
  client.insert(actionLog).values({
    id: nanoid(),
    userId: ctx.userId,
    tableName: "gameAsset",
    changes: [`Deleted: ${entry.name}`],
    relatedId: entry.id,
    relatedMsg: `Delete: ${entry.name}`,
    relatedImage: entry.image,
  });
