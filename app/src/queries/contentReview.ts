/**
 * Database access for content review; authorization and transaction scopes stay in callers.
 */
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notExists,
  or,
  type SQL,
  sum,
} from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import type {
  ContentAuditFocus,
  ContentProposalCategory,
  ContentProposalEntityType,
  ContentProposalRejectReason,
  ContentProposalStatus,
} from "@/drizzle/constants";
import {
  badge,
  bloodline,
  contentProposal,
  contentProposalBasis,
  contentProposalChange,
  contentProposalMedia,
  dataBattleAction,
  gameAsset,
  item,
  jutsu,
  quest,
  title,
  userData,
  userItem,
  userJutsu,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { getUtcDayWindowStart, secondsFromNow } from "@/utils/time";

/**
 * A suggestion with its changes and media in submission order, its basis, and the author's
 * and reviewer's usernames; undefined when it does not exist.
 */
export const fetchProposal = async (client: DrizzleClient, id: string) =>
  client.query.contentProposal.findFirst({
    where: eq(contentProposal.id, id),
    with: {
      changes: { orderBy: (table, { asc }) => [asc(table.sortOrder)] },
      basis: true,
      media: { orderBy: (table, { asc }) => [asc(table.sortOrder)] },
      createdBy: { columns: { username: true } },
      reviewedBy: { columns: { username: true } },
    },
  });

/** Build the `contentProposal` listing for `getQueue`, including predicates on `status`, `category`, `source`. */
export const listContentProposalForGetQueue = (
  client: Pick<DrizzleClient, "query" | "select">,
  input: {
    status: ContentProposalStatus;
    category?: ContentProposalCategory | undefined | null;
    source?: undefined | null | "STAFF" | "AGENT";
    entityType?: ContentProposalEntityType | undefined | null;
    limit: number;
  },
  canReview: false | true,
  ctx: { userId: string },
  offset: number,
) =>
  client.query.contentProposal.findMany({
    where: and(
      eq(contentProposal.status, input.status),
      input.category ? eq(contentProposal.category, input.category) : undefined,
      input.source ? eq(contentProposal.source, input.source) : undefined,
      input.entityType
        ? inArray(
            contentProposal.id,
            client
              .select({ id: contentProposalChange.proposalId })
              .from(contentProposalChange)
              .where(eq(contentProposalChange.entityType, input.entityType)),
          )
        : undefined,
      canReview ? undefined : eq(contentProposal.createdByUserId, ctx.userId),
    ),
    with: {
      changes: { orderBy: (table, { asc }) => [asc(table.sortOrder)] },
      basis: true,
      createdBy: { columns: { username: true } },
      reviewedBy: { columns: { username: true } },
    },
    orderBy:
      input.status === "PENDING"
        ? [asc(contentProposal.createdAt)]
        : [desc(contentProposal.statusChangedAt)],
    offset,
    limit: input.limit + 1,
  });

/** Build the `contentProposal` selection for `getCounts`, using the configured predicates. */
export const selectContentProposalForGetCounts = (
  client: Pick<DrizzleClient, "select">,
  scope: undefined | SQL<unknown>,
) =>
  client
    .select({ status: contentProposal.status, n: count() })
    .from(contentProposal)
    .where(scope)
    .groupBy(contentProposal.status);

/** Build the `contentProposal` selection for `getCounts`, using predicates on `status`. */
export const selectContentProposalForGetCounts2 = (
  client: Pick<DrizzleClient, "select">,
  scope: undefined | SQL<unknown>,
) =>
  client
    .select({ category: contentProposal.category, n: count() })
    .from(contentProposal)
    .where(and(eq(contentProposal.status, "PENDING"), scope))
    .groupBy(contentProposal.category);

/** Build the `gameAsset` selection for `getProposal`, using predicates on `id`. */
export const selectGameAssetForGetProposal = (
  client: Pick<DrizzleClient, "select">,
  assetIds: Set<string>,
) =>
  client
    .select({
      id: gameAsset.id,
      name: gameAsset.name,
      type: gameAsset.type,
      image: gameAsset.image,
      url: gameAsset.url,
      frames: gameAsset.frames,
      speed: gameAsset.speed,
    })
    .from(gameAsset)
    .where(inArray(gameAsset.id, [...assetIds]));

/** Build the `contentProposal` update for `reject`, using predicates on `id`, `status`, `statusChangedAt`. */
export const updateContentProposalForReject = (
  client: Pick<DrizzleClient, "update">,
  input: {
    id: string;
    expectedStatusChangedAt?: string | undefined;
    reason: ContentProposalRejectReason;
    note?: string | null | undefined;
  },
  ctx: { userId: string },
) =>
  client
    .update(contentProposal)
    .set({
      status: "REJECTED",
      rejectReason: input.reason,
      reviewNote: input.note?.trim() || null,
      reviewedByUserId: ctx.userId,
      statusChangedAt: new Date(),
    })
    .where(
      and(
        eq(contentProposal.id, input.id),
        eq(contentProposal.status, "PENDING"),
        input.expectedStatusChangedAt
          ? eq(contentProposal.statusChangedAt, new Date(input.expectedStatusChangedAt))
          : undefined,
      ),
    );

/** Build the `contentProposal` update for `unreject`, using predicates on `id`, `status`, `statusChangedAt`. */
export const updateContentProposalForUnreject = (
  client: Pick<DrizzleClient, "update">,
  statusChangedAt: Date,
  input: { id: string; expectedStatusChangedAt: string },
) =>
  client
    .update(contentProposal)
    .set({
      status: "PENDING",
      rejectReason: null,
      reviewNote: null,
      reviewedByUserId: null,
      outdatedReason: null,
      statusChangedAt,
    })
    .where(
      and(
        eq(contentProposal.id, input.id),
        eq(contentProposal.status, "REJECTED"),
        eq(contentProposal.statusChangedAt, new Date(input.expectedStatusChangedAt)),
      ),
    );

/**
 * Build the `contentProposal` update for `revert`, setting `status` and
 * `statusChangedAt`, using predicates on `id` and `status`.
 */
export const updateContentProposalForRevert = (
  client: Pick<DrizzleClient, "update">,
  proposal: { id: string },
) =>
  client
    .update(contentProposal)
    .set({ status: "REVERTED", statusChangedAt: new Date() })
    .where(
      and(eq(contentProposal.id, proposal.id), eq(contentProposal.status, "APPLIED")),
    );

/** Build the `contentProposal` update for `restore`, setting `status` and `statusChangedAt`, using predicates on `id`. */
export const updateContentProposalForRestore = (
  client: Pick<DrizzleClient, "update">,
  appliedAt: Date,
  proposal: { id: string },
) =>
  client
    .update(contentProposal)
    .set({ status: "APPLIED", statusChangedAt: appliedAt })
    .where(eq(contentProposal.id, proposal.id));

/** Build the `contentProposal` listing for `getStats`, using predicates on `createdAt`. */
export const listContentProposalForGetStats = (
  client: Pick<DrizzleClient, "query">,
  input: { days: number },
  now: Date,
) =>
  client.query.contentProposal.findMany({
    columns: {
      id: true,
      source: true,
      agentName: true,
      category: true,
      status: true,
      createdAt: true,
    },
    where: gte(contentProposal.createdAt, getUtcDayWindowStart(input.days, now)),
    with: { changes: { columns: { entityType: true } } },
  });

/** Build the `contentProposal` update for `applyProposal`, using predicates on `id`, `status`, `statusChangedAt`. */
export const updateContentProposalForApplyProposal = (
  client: Pick<DrizzleClient, "update">,
  ctx: { userId: string },
  proposal: { id: string; statusChangedAt: Date },
) =>
  client
    .update(contentProposal)
    .set({
      status: "APPLIED",
      reviewedByUserId: ctx.userId,
      statusChangedAt: new Date(),
    })
    .where(
      and(
        eq(contentProposal.id, proposal.id),
        eq(contentProposal.status, "PENDING"),
        eq(contentProposal.statusChangedAt, proposal.statusChangedAt),
      ),
    );

/** Insert an asset while preserving the existing row when its id is already in the library. */
export const insertGameAssetIfAbsent = (
  client: Pick<DrizzleClient, "insert">,
  asset: typeof gameAsset.$inferInsert,
) =>
  client
    .insert(gameAsset)
    .values(asset)
    .onDuplicateKeyUpdate({ set: { id: asset.id } });

/**
 * Build the `contentProposalChange` update for `applyProposal`, setting `applied` and
 * `entityId`, using predicates on `id`.
 */
export const updateContentProposalChangeForApplyProposal = (
  client: Pick<DrizzleClient, "update">,
  applied: { [k: string]: unknown },
  entityId: string,
  plan: { change: { id: string } },
) =>
  client
    .update(contentProposalChange)
    .set({ applied, entityId })
    .where(eq(contentProposalChange.id, plan.change.id));

/** Build the `contentProposalMedia` update for `applyProposal`, setting `chosen`, using predicates on `id`. */
export const updateContentProposalMediaForApplyProposal = (
  client: Pick<DrizzleClient, "update">,
  chosenMedia: string[],
) =>
  client
    .update(contentProposalMedia)
    .set({ chosen: true })
    .where(inArray(contentProposalMedia.id, chosenMedia));

/** Build the `gameAsset` deletion for `rollback`, using predicates on `id`. */
export const deleteGameAssetForRollback = (
  client: Pick<DrizzleClient, "delete">,
  assets: (typeof gameAsset.$inferInsert)[],
) =>
  client.delete(gameAsset).where(
    inArray(
      gameAsset.id,
      assets.map((asset) => asset.id),
    ),
  );

/** Build the `contentProposal` update for `rollback`, using predicates on `id`. */
export const updateContentProposalForRollback = (
  client: Pick<DrizzleClient, "update">,
  proposalId: string,
) =>
  client
    .update(contentProposal)
    .set({ status: "PENDING", reviewedByUserId: null, statusChangedAt: new Date() })
    .where(eq(contentProposal.id, proposalId));

/**
 * Build the `contentProposal` selection for `cleanupContentProposals`, using
 * predicates on `status` and `statusChangedAt`.
 */
export const selectContentProposalForCleanupContentProposals = (
  client: Pick<DrizzleClient, "select">,
  cutoff: Date,
  BATCH: 500,
) =>
  client
    .select({
      id: contentProposal.id,
      status: contentProposal.status,
      statusChangedAt: contentProposal.statusChangedAt,
    })
    .from(contentProposal)
    .where(
      and(
        inArray(contentProposal.status, ["REJECTED", "OUTDATED"]),
        lt(contentProposal.statusChangedAt, cutoff),
      ),
    )
    .limit(BATCH);

/**
 * Build the `contentProposal` deletion for `cleanupContentProposals`, using predicates
 * on `id`, `status`, `statusChangedAt`.
 */
export const deleteContentProposalForCleanupContentProposals = (
  client: Pick<DrizzleClient, "delete">,
  expired: Pick<
    import("@/drizzle/schema").ContentProposal,
    "id" | "status" | "statusChangedAt"
  >[],
  cutoff: Date,
) =>
  client
    .delete(contentProposal)
    .where(
      and(
        or(
          ...expired.map((candidate) =>
            and(
              eq(contentProposal.id, candidate.id),
              eq(contentProposal.status, candidate.status),
              eq(contentProposal.statusChangedAt, candidate.statusChangedAt),
            ),
          ),
        ),
        inArray(contentProposal.status, ["REJECTED", "OUTDATED"]),
        lt(contentProposal.statusChangedAt, cutoff),
      ),
    );

/**
 * Build the `contentProposalMedia` selection for `cleanupContentProposals`, including
 * predicates on `id`, `status`, `chosen`.
 */
export const selectContentProposalMediaForCleanupContentProposals = (
  client: Pick<DrizzleClient, "select">,
  LEFTOVER_GRACE_S: number,
  BATCH: 500,
) =>
  client
    .select({ id: contentProposalMedia.id, fileKey: contentProposalMedia.fileKey })
    .from(contentProposalMedia)
    .leftJoin(contentProposal, eq(contentProposal.id, contentProposalMedia.proposalId))
    .where(
      or(
        isNull(contentProposal.id),
        and(
          inArray(contentProposal.status, ["APPLIED", "REVERTED"]),
          eq(contentProposalMedia.chosen, false),
          isNotNull(contentProposalMedia.fileKey),
          // An approval claims APPLIED before saving selected media. Allow its bounded
          // request to finish before treating still-unchosen candidates as leftovers.
          lt(contentProposal.statusChangedAt, secondsFromNow(-LEFTOVER_GRACE_S)),
        ),
      ),
    )
    .limit(BATCH);

/** Build the `contentProposalMedia` deletion for `cleanupContentProposals`, using predicates on `id`. */
export const deleteContentProposalMediaForCleanupContentProposals = (
  client: Pick<DrizzleClient, "delete">,
  leftovers: Pick<import("@/drizzle/schema").ContentProposalMedia, "id" | "fileKey">[],
) =>
  client.delete(contentProposalMedia).where(
    inArray(
      contentProposalMedia.id,
      leftovers.map((row) => row.id),
    ),
  );

/** Build the `contentProposalBasis` deletion for `cleanupContentProposals`, using predicates on `id` and `proposalId`. */
export const deleteContentProposalBasisForCleanupContentProposals = (
  client: Pick<DrizzleClient, "delete" | "select">,
  BATCH: 500,
) =>
  client
    .delete(contentProposalBasis)
    .where(
      notExists(
        client
          .select({ id: contentProposal.id })
          .from(contentProposal)
          .where(eq(contentProposal.id, contentProposalBasis.proposalId)),
      ),
    )
    .limit(BATCH);

/** Build the `contentProposalChange` deletion for `cleanupContentProposals`, using predicates on `id` and `proposalId`. */
export const deleteContentProposalChangeForCleanupContentProposals = (
  client: Pick<DrizzleClient, "delete" | "select">,
  BATCH: 500,
) =>
  client
    .delete(contentProposalChange)
    .where(
      notExists(
        client
          .select({ id: contentProposal.id })
          .from(contentProposal)
          .where(eq(contentProposal.id, contentProposalChange.proposalId)),
      ),
    )
    .limit(BATCH);

/** Unique name column of each content type whose whole table takes part in name checks. */
const NAME_COLUMNS = {
  JUTSU: jutsu.name,
  ITEM: item.name,
  BLOODLINE: bloodline.name,
  QUEST: quest.name,
  BADGE: badge.name,
  GAME_ASSET: gameAsset.name,
  AI: userData.username,
};

/** Build the selection of the `names` a content type's rows already hold. */
export const selectContentNames = (
  client: Pick<DrizzleClient, "select">,
  entityType: keyof typeof NAME_COLUMNS,
  names: string[],
) => {
  const column: AnyMySqlColumn<{ data: string; notNull: true }> =
    NAME_COLUMNS[entityType];
  return client
    .select({ name: column })
    .from(column.table)
    .where(inArray(column, names));
};

/** Build the `jutsu` selection for `load`, using predicates on `id`. */
export const selectJutsuForLoad = (
  client: Pick<DrizzleClient, "select">,
  ids: null | string[],
) =>
  client
    .select()
    .from(jutsu)
    .where(ids ? inArray(jutsu.id, ids) : undefined);

/** Build the `item` listing for `load`, using predicates on `id`. */
export const listItemForLoad = (
  client: Pick<DrizzleClient, "query">,
  ids: null | string[],
) =>
  client.query.item.findMany({
    where: ids ? inArray(item.id, ids) : undefined,
    with: { craftingRequirements: true },
  });

/** Build the `bloodline` selection for `load`, using predicates on `id`. */
export const selectBloodlineForLoad = (
  client: Pick<DrizzleClient, "select">,
  ids: null | string[],
) =>
  client
    .select()
    .from(bloodline)
    .where(ids ? inArray(bloodline.id, ids) : undefined);

/** Build the `quest` selection for `load`, using predicates on `id`. */
export const selectQuestForLoad = (
  client: Pick<DrizzleClient, "select">,
  ids: null | string[],
) =>
  client
    .select()
    .from(quest)
    .where(ids ? inArray(quest.id, ids) : undefined);

/** Build the `badge` selection for `load`, using predicates on `id`. */
export const selectBadgeForLoad = (
  client: Pick<DrizzleClient, "select">,
  ids: null | string[],
) =>
  client
    .select()
    .from(badge)
    .where(ids ? inArray(badge.id, ids) : undefined);

/** Build the `title` listing for `load`, using predicates on `legacyOwnerId` and `id`. */
export const listTitleForLoad = (
  client: Pick<DrizzleClient, "query">,
  ids: null | string[],
) =>
  client.query.title.findMany({
    where: and(isNull(title.legacyOwnerId), ids ? inArray(title.id, ids) : undefined),
  });

/** Build the `title` selection for `findNames`, using predicates on `legacyOwnerId` and `name`. */
export const selectTitleForFindNames = (
  client: Pick<DrizzleClient, "select">,
  names: string[],
) =>
  client
    .select({ name: title.name })
    .from(title)
    .where(and(isNull(title.legacyOwnerId), inArray(title.name, names)));

/** Build the `gameAsset` selection for `load`, using predicates on `id`. */
export const selectGameAssetForLoad = (
  client: Pick<DrizzleClient, "select">,
  ids: null | string[],
) =>
  client
    .select()
    .from(gameAsset)
    .where(ids ? inArray(gameAsset.id, ids) : undefined);

/** Build the `userData` listing for `load`, using predicates on `userId` and `isAi`. */
export const listUserDataForLoad = (
  client: Pick<DrizzleClient, "query">,
  ids: null | string[],
) =>
  client.query.userData.findMany({
    where: and(
      ids ? inArray(userData.userId, ids) : undefined,
      eq(userData.isAi, true),
    ),
    with: {
      spriteAnimationBindings: { with: { animation: true } },
      jutsus: { with: { jutsu: { columns: { id: true } } } },
      items: { with: { item: { columns: { id: true } } } },
    },
  });

/** Build the `gameAsset` selection for `collectCandidates`, using predicates on `id`. */
export const selectGameAssetForCollectCandidates = (
  client: Pick<DrizzleClient, "select">,
  request: { catalogIds: string[] },
) => client.select().from(gameAsset).where(inArray(gameAsset.id, request.catalogIds));

/**
 * Build the `contentProposalBasis` selection for `outdateProposalsFor`, using
 * predicates on `entityType`, `entityId`, `status`.
 */
export const selectContentProposalBasisForOutdateProposalsFor = (
  client: Pick<DrizzleClient, "select">,
  entityType: ContentProposalEntityType,
  entityIds: string[],
) =>
  client
    .select({
      id: contentProposalBasis.proposalId,
      statusChangedAt: contentProposal.statusChangedAt,
      entityId: contentProposalBasis.entityId,
      version: contentProposalBasis.version,
    })
    .from(contentProposalBasis)
    .innerJoin(contentProposal, eq(contentProposal.id, contentProposalBasis.proposalId))
    .where(
      and(
        eq(contentProposalBasis.entityType, entityType),
        inArray(contentProposalBasis.entityId, entityIds),
        eq(contentProposal.status, "PENDING"),
      ),
    );

/** Build the `contentProposal` selection for `reinstateProposalsFor`, using predicates on `status` and `statusChangedAt`. */
export const selectContentProposalForReinstateProposalsFor = (
  client: Pick<DrizzleClient, "select">,
  since: Date,
) =>
  client
    .select({
      id: contentProposal.id,
      statusChangedAt: contentProposal.statusChangedAt,
      expiresAt: contentProposal.expiresAt,
      entityType: contentProposalBasis.entityType,
      entityId: contentProposalBasis.entityId,
      version: contentProposalBasis.version,
    })
    .from(contentProposal)
    .innerJoin(
      contentProposalBasis,
      eq(contentProposalBasis.proposalId, contentProposal.id),
    )
    .where(
      and(
        eq(contentProposal.status, "OUTDATED"),
        gte(contentProposal.statusChangedAt, since),
      ),
    );

/** Build the `contentProposal` update for `reinstateProposalsFor`, using predicates on `id`, `statusChangedAt`, `status`. */
export const updateContentProposalForReinstateProposalsFor = (
  client: Pick<DrizzleClient, "update">,
  current: {
    id: string;
    statusChangedAt: Date;
    expiresAt: null | Date;
    entityType: ContentProposalEntityType;
    entityId: string;
    version: string;
  }[][],
) =>
  client
    .update(contentProposal)
    .set({ status: "PENDING", outdatedReason: null, statusChangedAt: new Date() })
    .where(
      and(
        or(
          ...current.flatMap((basis) =>
            basis[0]
              ? [
                  and(
                    eq(contentProposal.id, basis[0].id),
                    eq(contentProposal.statusChangedAt, basis[0].statusChangedAt),
                  ),
                ]
              : [],
          ),
        ),
        eq(contentProposal.status, "OUTDATED"),
      ),
    );

/** Build the `contentProposal` selection for `expireStaleEvidence`, using predicates on `status` and `expiresAt`. */
export const selectContentProposalForExpireStaleEvidence = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      id: contentProposal.id,
      statusChangedAt: contentProposal.statusChangedAt,
    })
    .from(contentProposal)
    .where(
      and(
        eq(contentProposal.status, "PENDING"),
        lt(contentProposal.expiresAt, new Date()),
      ),
    );

/** Build the `contentProposal` update for `markOutdated`, using predicates on `id`, `statusChangedAt`, `status`. */
export const updateContentProposalForMarkOutdated = (
  client: Pick<DrizzleClient, "update">,
  reason: string,
  revisions: Pick<
    import("@/drizzle/schema").ContentProposal,
    "id" | "statusChangedAt"
  >[],
) =>
  client
    .update(contentProposal)
    .set({
      status: "OUTDATED",
      outdatedReason: reason.slice(0, 191),
      statusChangedAt: new Date(),
    })
    .where(
      and(
        or(
          ...revisions.map((row) =>
            and(
              eq(contentProposal.id, row.id),
              eq(contentProposal.statusChangedAt, row.statusChangedAt),
            ),
          ),
        ),
        eq(contentProposal.status, "PENDING"),
      ),
    );

/** Build the `gameAsset` selection for `buildAuditSnapshot`, using predicates on `type` and `hidden`. */
export const selectGameAssetForBuildAuditSnapshot = (
  client: Pick<DrizzleClient, "select">,
  view: {
    assets: ("STATIC" | "ANIMATION" | "SCENE_BACKGROUND" | "SCENE_CHARACTER" | "SFX")[];
  },
) =>
  client
    .select()
    .from(gameAsset)
    .where(and(inArray(gameAsset.type, view.assets), eq(gameAsset.hidden, false)));

/** Build the `dataBattleAction` selection for `usageStats`, using predicates on `type`. */
export const selectDataBattleActionForUsageStats = (
  client: Pick<DrizzleClient, "select">,
) =>
  client
    .select({
      type: dataBattleAction.type,
      contentId: dataBattleAction.contentId,
      battleWon: dataBattleAction.battleWon,
      n: sum(dataBattleAction.count).mapWith(Number),
    })
    .from(dataBattleAction)
    .where(inArray(dataBattleAction.type, ["jutsu", "item", "bloodline"]))
    .groupBy(
      dataBattleAction.type,
      dataBattleAction.contentId,
      dataBattleAction.battleWon,
    );

/** Build the `userJutsu` selection for `ownerCounts`. */
export const selectUserJutsuForOwnerCounts = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ id: userJutsu.jutsuId, n: count() })
    .from(userJutsu)
    .groupBy(userJutsu.jutsuId);

/** Build the `userItem` selection for `ownerCounts`. */
export const selectUserItemForOwnerCounts = (client: Pick<DrizzleClient, "select">) =>
  client
    .select({ id: userItem.itemId, n: count() })
    .from(userItem)
    .groupBy(userItem.itemId);

/** Build the `contentProposal` selection for `recentSuggestions`, using predicates on `status` and `statusChangedAt`. */
export const selectContentProposalForRecentSuggestions = (
  client: Pick<DrizzleClient, "select">,
  since: Date,
) =>
  client
    .select({
      id: contentProposal.id,
      title: contentProposal.title,
      category: contentProposal.category,
      status: contentProposal.status,
      rejectReason: contentProposal.rejectReason,
      reviewNote: contentProposal.reviewNote,
      outdatedReason: contentProposal.outdatedReason,
      entityType: contentProposalChange.entityType,
      entityId: contentProposalChange.entityId,
      after: contentProposalChange.after,
    })
    .from(contentProposal)
    .innerJoin(
      contentProposalChange,
      eq(contentProposalChange.proposalId, contentProposal.id),
    )
    .where(
      or(
        eq(contentProposal.status, "PENDING"),
        gte(contentProposal.statusChangedAt, since),
      ),
    );

/** The rows one suggestion writes, across its four tables. */
export type Rows = {
  proposal: ProposalInsert;
  changes: ChangeInsert[];
  basis: BasisInsert[];
  media: MediaInsert[];
};

/** Fetch a draft and its current optimistic revision token without altering freshness. */
export const readAgentProposal = (client: DrizzleClient, id: string) =>
  client.query.contentProposal.findFirst({
    where: eq(contentProposal.id, id),
    with: { changes: true, basis: true, media: true },
  });

/** Build the `contentProposal` update for `reviseAgentProposal`, including predicates on `id`, `source`, `status`. */
export const updateContentProposalForReviseAgentProposal = (
  client: Pick<DrizzleClient, "update">,
  plan: {
    proposal: {
      title: string;
      rationale: string;
      category: ContentProposalCategory;
      confidence?: undefined | null | number;
      expiresAt?: undefined | null | Date;
    };
  },
  input: {
    runUrl?: undefined | null | string;
    focus?: ContentAuditFocus | undefined | null;
  },
  existing: {
    runUrl: null | string;
    focus: null | string;
    status: ContentProposalStatus;
    statusChangedAt: Date;
  },
  nextAt: Date,
  id: string,
) =>
  client
    .update(contentProposal)
    .set({
      title: plan.proposal.title,
      rationale: plan.proposal.rationale,
      category: plan.proposal.category,
      confidence: plan.proposal.confidence,
      expiresAt: plan.proposal.expiresAt,
      runUrl: input.runUrl ?? existing.runUrl,
      focus: input.focus ?? existing.focus,
      status: "PENDING",
      statusChangedAt: nextAt,
      // Retain the decision metadata so staff can see the feedback that prompted a revision.
    })
    .where(
      and(
        eq(contentProposal.id, id),
        eq(contentProposal.source, "AGENT"),
        eq(contentProposal.status, existing.status),
        eq(contentProposal.statusChangedAt, existing.statusChangedAt),
      ),
    );

/** Build the `contentProposalMedia` deletion for `reviseAgentProposal`, using predicates on `proposalId`. */
export const deleteContentProposalMediaForReviseAgentProposal = (
  client: Pick<DrizzleClient, "delete">,
  id: string,
) => client.delete(contentProposalMedia).where(eq(contentProposalMedia.proposalId, id));

/** Build the `contentProposalBasis` deletion for `reviseAgentProposal`, using predicates on `proposalId`. */
export const deleteContentProposalBasisForReviseAgentProposal = (
  client: Pick<DrizzleClient, "delete">,
  id: string,
) => client.delete(contentProposalBasis).where(eq(contentProposalBasis.proposalId, id));

/** Build the `contentProposalChange` deletion for `reviseAgentProposal`, using predicates on `proposalId`. */
export const deleteContentProposalChangeForReviseAgentProposal = (
  client: Pick<DrizzleClient, "delete">,
  id: string,
) =>
  client.delete(contentProposalChange).where(eq(contentProposalChange.proposalId, id));

/** Build the `contentProposalChange` selection for `openTargets`, using predicates on `status`, `id`, `entityId`. */
export const selectContentProposalChangeForOpenTargets = (
  client: Pick<DrizzleClient, "select">,
  excludeId: undefined | string,
  ids: string[],
) =>
  client
    .select({
      entityType: contentProposalChange.entityType,
      entityId: contentProposalChange.entityId,
    })
    .from(contentProposalChange)
    .innerJoin(
      contentProposal,
      eq(contentProposal.id, contentProposalChange.proposalId),
    )
    .where(
      and(
        eq(contentProposal.status, "PENDING"),
        excludeId ? ne(contentProposal.id, excludeId) : undefined,
        inArray(contentProposalChange.entityId, ids),
      ),
    );

/** Rejected changes still within retention, so the audit cannot resubmit them unchanged. */
export const rejectedChanges = async (
  client: DrizzleClient,
  ids: string[],
  excludeId?: string,
) =>
  client
    .select({
      entityType: contentProposalChange.entityType,
      entityId: contentProposalChange.entityId,
      after: contentProposalChange.after,
    })
    .from(contentProposalChange)
    .innerJoin(
      contentProposal,
      eq(contentProposal.id, contentProposalChange.proposalId),
    )
    .where(
      and(
        eq(contentProposal.status, "REJECTED"),
        excludeId ? ne(contentProposal.id, excludeId) : undefined,
        inArray(contentProposalChange.entityId, ids),
      ),
    );

/** Build the `contentProposalChange` selection for `takenNames`, including predicates on `status`, `operation`, `id`. */
export const selectContentProposalChangeForTakenNames = (
  client: Pick<DrizzleClient, "select">,
  excludeId: undefined | string,
  types: ContentProposalEntityType[],
) =>
  client
    .select({
      entityType: contentProposalChange.entityType,
      after: contentProposalChange.after,
    })
    .from(contentProposalChange)
    .innerJoin(
      contentProposal,
      eq(contentProposal.id, contentProposalChange.proposalId),
    )
    .where(
      and(
        eq(contentProposal.status, "PENDING"),
        eq(contentProposalChange.operation, "CREATE"),
        excludeId ? ne(contentProposal.id, excludeId) : undefined,
        inArray(contentProposalChange.entityType, types),
      ),
    );

/** Build the `contentProposal` insert for `insertRows`. */
export const insertContentProposalForInsertRows = (
  client: Pick<DrizzleClient, "insert">,
  rows: Rows[],
) => client.insert(contentProposal).values(rows.map((row) => row.proposal));

/** Build insertion of a content proposal’s change rows. */
export const insertContentProposalChanges = (
  client: Pick<DrizzleClient, "insert">,
  changes: ChangeInsert[],
) => client.insert(contentProposalChange).values(changes);

/** Build insertion of a content proposal’s basis rows. */
export const insertContentProposalBasis = (
  client: Pick<DrizzleClient, "insert">,
  basis: import("@/drizzle/schema").ContentProposalBasis[],
) => client.insert(contentProposalBasis).values(basis);

/** Build insertion of a content proposal’s media rows. */
export const insertContentProposalMedia = (
  client: Pick<DrizzleClient, "insert">,
  media: MediaInsert[],
) => client.insert(contentProposalMedia).values(media);

/** Schema-derived insert contract for a content proposal. */
type ProposalInsert = typeof contentProposal.$inferInsert;

/** Schema-derived insert contract for one proposed content change. */
type ChangeInsert = typeof contentProposalChange.$inferInsert;

/** Schema-derived insert contract for a proposal basis row. */
type BasisInsert = typeof contentProposalBasis.$inferInsert;

/** Schema-derived insert contract for proposal media metadata. */
export type MediaInsert = typeof contentProposalMedia.$inferInsert;
