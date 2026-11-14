import { eq } from "drizzle-orm";
import { z } from "zod";
import type {
  ContentProposalCategory,
  ContentProposalEntityType,
  ContentProposalStatus,
  ItemType,
} from "@/drizzle/constants";
import {
  CONTENT_PROPOSAL_NOTE_MAX_LENGTH,
  CONTENT_REVIEW_BULK_LIMIT,
  CONTENT_REVIEW_SFX_SEARCH_RESULTS,
  ContentProposalCategories,
  ContentProposalEntityTypes,
  ContentProposalRejectReasons,
  ContentProposalSources,
  ContentProposalStatuses,
} from "@/drizzle/constants";
import type { UserData } from "@/drizzle/schema";
import { contentProposal, type gameAsset } from "@/drizzle/schema";
import {
  type ContentEntity,
  draftName,
  ENTITY_CONFIG,
  editableOf,
  entityKey,
  loadEntities,
  normalizeEditable,
} from "@/libs/contentReview/entities";
import { isEpidemicConfigured, searchEpidemicSfx } from "@/libs/contentReview/epidemic";
import { ENTITY_LABELS } from "@/libs/contentReview/labels";
import { importEpidemicSfx, materializeChoice } from "@/libs/contentReview/media";
import {
  refreshProposalFreshness,
  reinstateProposalsFor,
} from "@/libs/contentReview/outdate";
import {
  getAtPath,
  isSceneCharacterPath,
  questSceneAssetIds,
  setAtPath,
  topLevelField,
} from "@/libs/contentReview/paths";
import { buildReviewStats } from "@/libs/contentReview/stats";
import { createStaffProposal, validationError } from "@/libs/contentReview/submit";
import { sameValue } from "@/libs/contentReview/version";
import {
  deleteGameAssetForRollback,
  fetchProposal,
  insertGameAssetIfAbsent,
  listContentProposalForGetQueue,
  listContentProposalForGetStats,
  selectContentProposalForGetCounts,
  selectContentProposalForGetCounts2,
  selectGameAssetForGetProposal,
  updateContentProposalChangeForApplyProposal,
  updateContentProposalForApplyProposal,
  updateContentProposalForReject,
  updateContentProposalForRestore,
  updateContentProposalForRevert,
  updateContentProposalForRollback,
  updateContentProposalForUnreject,
  updateContentProposalMediaForApplyProposal,
} from "@/queries/contentReview";
import { fetchUser } from "@/queries/profile";
import { gameAssetRouter } from "@/routers/asset";
import { badgeRouter } from "@/routers/badge";
import { bloodlineRouter } from "@/routers/bloodline";
import { itemRouter } from "@/routers/item";
import { jutsuRouter } from "@/routers/jutsu";
import { profileRouter } from "@/routers/profile";
import { questsRouter } from "@/routers/quests";
import { titleRouter } from "@/routers/title";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import { clientErrorMessage } from "@/server/utils/mysqlErrors";
import { canChangeContent, canSuggestContent, isStaffRole } from "@/utils/permissions";
import type { insertAiSchema } from "@/validators/aiInput";
import type { gameAssetValidator } from "@/validators/asset";
import type { BadgeValidator } from "@/validators/badge";
import type {
  BloodlineValidator,
  ItemValidator,
  JutsuValidator,
} from "@/validators/combat";
import {
  reviewStatsSchema,
  staffCreateProposalSchema,
} from "@/validators/contentReview";
import type { QuestValidator } from "@/validators/objectives";
import type { TitleValidator } from "@/validators/title";

const reviewQueueSchema = z.object({
  status: z.enum(ContentProposalStatuses),
  category: z.enum(ContentProposalCategories).nullish(),
  source: z.enum(ContentProposalSources).nullish(),
  entityType: z.enum(ContentProposalEntityTypes).nullish(),
  /** Offset of the page's first row. */
  cursor: z.number().int().min(0).nullish(),
  limit: z.number().int().min(1).max(50).prefault(25),
});

const approveProposalSchema = z.object({
  id: z.string(),
  expectedStatusChangedAt: z.iso.datetime().optional(),
  /** Fields the reviewer unticked, per change. */
  exclude: z
    .array(z.object({ changeId: z.string(), field: z.string() }))
    .max(80)
    .prefault([]),
  /** Reviewer edits to proposed top-level values, per change. */
  edits: z
    .array(z.object({ changeId: z.string(), field: z.string(), value: z.unknown() }))
    .max(80)
    .prefault([]),
  /** Chosen media candidate per field; the first candidate is used when absent. */
  media: z
    .array(z.object({ mediaId: z.string() }))
    .max(12)
    .prefault([]),
});

type ApproveProposalInput = z.infer<typeof approveProposalSchema>;

const rejectProposalSchema = z.object({
  id: z.string(),
  expectedStatusChangedAt: z.iso.datetime().optional(),
  reason: z.enum(ContentProposalRejectReasons),
  note: z.string().max(CONTENT_PROPOSAL_NOTE_MAX_LENGTH).nullish(),
});

const unrejectProposalSchema = z.object({
  id: z.string(),
  expectedStatusChangedAt: z.iso.datetime(),
});

const bulkApproveSchema = z.object({
  ids: z.array(z.string()).min(1).max(CONTENT_REVIEW_BULK_LIMIT),
});

const proposalIdSchema = z.object({ id: z.string() });

const sfxSearchSchema = z.object({
  term: z.string().trim().min(2).max(100),
});

const sfxImportSchema = z.object({
  epidemicId: z.string().min(1).max(191),
  title: z.string().min(1).max(191),
});

export const contentReviewRouter = createTRPCRouter({
  /**
   * One page of a review desk tab: pending suggestions oldest first, the other tabs
   * newest status change first. Reviewers see every suggestion, other staff only their
   * own, and everyone else an empty page. `outdatedCount` is how many suggestions this
   * read moved out of the pending list, so the client knows its counts are stale.
   */
  getQueue: protectedProcedure
    .input(reviewQueueSchema)
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!isStaffRole(user.role))
        return { items: [], nextCursor: null, canReview: false, outdatedCount: 0 };
      const canReview = canChangeContent(user.role);
      const offset = input.cursor ?? 0;
      const rows = await listContentProposalForGetQueue(
        ctx.drizzle,
        input,
        canReview,
        ctx,
        offset,
      );
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      // A page of pending suggestions is re-checked against the live rows, which catches
      // edits that bypassed the content editors before a reviewer spends time on them.
      const outdated =
        input.status === "PENDING" && canReview
          ? await refreshProposalFreshness(ctx.drizzle, page)
          : new Map<string, string>();
      const visible = page.filter((row) => !outdated.has(row.id));
      const entities = await loadEntities(ctx.drizzle, targetRefs(visible));
      return {
        items: visible.map((row) => toSummary(row, entities)),
        // Rows outdated on this page left the pending list, so the next page starts earlier.
        nextCursor: hasMore ? offset + input.limit - outdated.size : null,
        canReview,
        outdatedCount: outdated.size,
      };
    }),

  /**
   * Suggestions per status for the desk's tabs, and pending ones per category for its
   * filter. Reviewers count every suggestion, everyone else only their own.
   */
  getCounts: protectedProcedure.query(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    const canReview = canChangeContent(user.role);
    const scope = canReview
      ? undefined
      : eq(contentProposal.createdByUserId, ctx.userId);
    const [byStatus, byCategory] = await Promise.all([
      selectContentProposalForGetCounts(ctx.drizzle, scope),
      selectContentProposalForGetCounts2(ctx.drizzle, scope),
    ]);
    return {
      canReview,
      statuses: Object.fromEntries(
        byStatus.map((row) => [row.status, row.n]),
      ) as Partial<Record<ContentProposalStatus, number>>,
      pendingByCategory: Object.fromEntries(
        byCategory.map((row) => [row.category, row.n]),
      ) as Partial<Record<ContentProposalCategory, number>>,
    };
  }),

  /**
   * Everything the desk shows for one suggestion: each change with the live values of
   * its fields, the media candidates with the assets they and the live fields point at,
   * and the basis with its freshness. Null when it does not exist or the caller may not
   * see it.
   */
  getProposal: protectedProcedure
    .input(proposalIdSchema)
    .query(async ({ ctx, input }) => {
      const [user, proposal] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchProposal(ctx.drizzle, input.id),
      ]);
      if (!proposal || !isStaffRole(user.role)) return null;
      const canReview = canChangeContent(user.role);
      if (!canReview && proposal.createdByUserId !== ctx.userId) return null;
      const entities = await loadEntities(ctx.drizzle, [
        ...targetRefs([proposal]),
        ...proposal.basis,
      ]);
      const outdated =
        proposal.status === "PENDING" && canReview
          ? await refreshProposalFreshness(ctx.drizzle, [proposal], entities)
          : new Map<string, string>();
      const status = outdated.has(proposal.id) ? "OUTDATED" : proposal.status;
      /** Live value at `path` of a change's entity: an asset id or an image URL. */
      const currentAt = (changeId: string, path: string) => {
        const change = proposal.changes.find((entry) => entry.id === changeId);
        const entity = entityOfChange(entities, change);
        const value = entity ? getAtPath(entity.editable, path) : undefined;
        return typeof value === "string" && value ? value : null;
      };
      // Resolve catalog media and both versions of scene pictures in one asset query.
      const assetIds = new Set(
        proposal.media.flatMap((media) => [
          ...(media.source === "CATALOG" && media.externalId ? [media.externalId] : []),
          ...(media.kind !== "IMAGE" || isSceneCharacterPath(media.path)
            ? [currentAt(media.changeId, media.path) ?? ""]
            : []),
        ]),
      );
      for (const change of proposal.changes) {
        const entity = entityOfChange(entities, change);
        for (const fields of [
          entity?.payload,
          change.before,
          change.after,
          change.applied,
        ]) {
          for (const id of questSceneAssetIds(fields)) assetIds.add(id);
        }
      }
      assetIds.delete("");
      const assets = assetIds.size
        ? await selectGameAssetForGetProposal(ctx.drizzle, assetIds)
        : [];
      return {
        ...toSummary({ ...proposal, status }, entities),
        outdatedReason: outdated.get(proposal.id) ?? proposal.outdatedReason,
        rationale: proposal.rationale,
        canReview,
        changes: proposal.changes.map((change) => {
          const entity = entityOfChange(entities, change);
          const config = ENTITY_CONFIG[change.entityType];
          return {
            id: change.id,
            entityType: change.entityType,
            entityId: change.entityId,
            operation: change.operation,
            label: ENTITY_LABELS[change.entityType],
            name: entity?.name ?? (draftName(change.after) || "New"),
            detailHref: change.entityId ? config.detailHref(change.entityId) : null,
            before: change.before,
            after: change.after,
            applied: change.applied,
            payload: entity?.payload ?? null,
            media: proposal.media
              .filter((media) => media.changeId === change.id)
              .map((media) => ({
                id: media.id,
                path: media.path,
                source: media.source,
                kind: media.kind,
                externalId: media.externalId,
                title: media.title,
                url: media.url,
                lengthMs: media.lengthMs,
                chosen: media.chosen,
                currentValue: currentAt(change.id, media.path),
              })),
          };
        }),
        basis: proposal.basis.map((basis) => {
          const entity = entities.get(entityKey(basis.entityType, basis.entityId));
          return {
            entityType: basis.entityType,
            entityId: basis.entityId,
            role: basis.role,
            label: ENTITY_LABELS[basis.entityType],
            name: entity?.name ?? basis.entityId,
            version: basis.version,
            fresh: entity?.version === basis.version,
          };
        }),
        assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
      };
    }),

  /** Send an eligible staff suggestion, enforcing the manual editor's shared permission. */
  create: protectedProcedure
    .input(staffCreateProposalSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canSuggestContent(user.role))
        return errorResponse("Your role cannot suggest content changes");
      const result = await createStaffProposal(ctx.drizzle, ctx.userId, input);
      if (!result.ok) return errorResponse(result.reason);
      return { success: true, message: "Sent for review" };
    }),

  /**
   * Apply a pending suggestion with the reviewer's choices: unticked fields, edited values
   * and picked media candidates.
   */
  approve: protectedProcedure
    .input(approveProposalSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, proposal] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchProposal(ctx.drizzle, input.id),
      ]);
      if (!proposal) return errorResponse("Suggestion not found");
      return applyProposal(ctx, user, proposal, input);
    }),

  /**
   * Approve several suggestions with their defaults: every field, first media candidate.
   * Succeeds when at least one applied; the message names each failure and its reason.
   */
  bulkApprove: protectedProcedure
    .input(bulkApproveSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      const failures: string[] = [];
      let applied = 0;
      // One at a time: each approval runs the entity's own update procedure, and two of
      // them may touch the same entity.
      for (const id of input.ids) {
        const proposal = await fetchProposal(ctx.drizzle, id);
        const result = proposal
          ? await applyProposal(ctx, user, proposal, {
              id,
              exclude: [],
              edits: [],
              media: [],
            })
          : errorResponse("Suggestion not found");
        if (result.success) applied += 1;
        else failures.push(`${proposal?.title ?? id}: ${result.message}`);
      }
      return {
        success: applied > 0,
        message: [`Applied ${applied} of ${input.ids.length}.`, ...failures].join(" "),
      };
    }),

  /**
   * Reject a pending suggestion with a reason and an optional note, which the next audit
   * reads. The status guard lets only the first of two simultaneous decisions through.
   */
  reject: protectedProcedure
    .input(rejectProposalSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      const result = await updateContentProposalForReject(ctx.drizzle, input, ctx);
      if (result.rowsAffected !== 1) {
        return errorResponse("This suggestion was already decided or went out of date");
      }
      return { success: true, message: "Rejected. The next audit reads your reason." };
    }),

  /** Undo a rejection, rechecking freshness before returning it to review. */
  unreject: protectedProcedure
    .input(unrejectProposalSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, proposal] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchProposal(ctx.drizzle, input.id),
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      if (!proposal) return errorResponse("Suggestion not found");
      if (proposal.status !== "REJECTED")
        return errorResponse(
          "Only rejected suggestions can have their rejection undone",
        );
      const statusChangedAt = new Date(
        Math.max(Date.now(), proposal.statusChangedAt.getTime() + 1),
      );
      const result = await updateContentProposalForUnreject(
        ctx.drizzle,
        statusChangedAt,
        input,
      );
      if (result.rowsAffected !== 1)
        return errorResponse(
          "This suggestion changed. Reload before undoing its rejection.",
        );
      const outdated = await refreshProposalFreshness(ctx.drizzle, [
        { ...proposal, statusChangedAt },
      ]);
      const reason = outdated.get(proposal.id);
      return {
        success: true,
        message: reason
          ? `Rejection undone. The suggestion is outdated: ${reason}`
          : "Rejection undone. The suggestion is back in the pending queue.",
      };
    }),

  /**
   * Put the previous values back and delete what the suggestion created. Refused when an
   * entity was edited after the approval, since writing old values would silently undo
   * that edit. The status is claimed with a compare-and-swap, and a failure part way
   * re-applies what was already reverted. Suggestions the approval outdated return to the
   * queue once the old values are back.
   */
  revert: protectedProcedure
    .input(proposalIdSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, proposal] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchProposal(ctx.drizzle, input.id),
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      if (!proposal) return errorResponse("Suggestion not found");
      if (proposal.status !== "APPLIED")
        return errorResponse("Only applied suggestions can be reverted");
      const appliedAt = proposal.statusChangedAt;
      const changes = proposal.changes.filter(
        (change) => change.applied && change.entityId,
      );
      const entities = await loadEntities(ctx.drizzle, targetRefs([{ changes }]));
      for (const change of changes) {
        const entity = entities.get(
          entityKey(change.entityType, change.entityId as string),
        );
        const label = ENTITY_LABELS[change.entityType];
        if (!entity) {
          if (change.operation === "CREATE") continue;
          return errorResponse(`${label} ${change.entityId} no longer exists`);
        }
        const applied = change.applied ?? {};
        const live = storedEditable(change.entityType, entity.payload);
        const expected = storedEditable(change.entityType, {
          ...entity.payload,
          ...applied,
        });
        const wasEdited = Object.keys(applied).some(
          (field) => !sameValue(live[field], expected[field]),
        );
        if (wasEdited) {
          return errorResponse(
            `${label} ${entity.name} was edited after this suggestion was applied, so it cannot be reverted automatically`,
          );
        }
      }
      const claim = await updateContentProposalForRevert(ctx.drizzle, proposal);
      if (claim.rowsAffected !== 1)
        return errorResponse("This suggestion was already reverted");
      const startedAt = new Date();
      // Updates go back first and new entries are deleted last: a deleted entry cannot be
      // brought back if a later step fails.
      const ordered = [...changes]
        .reverse()
        .sort(
          (a, b) => Number(a.operation === "CREATE") - Number(b.operation === "CREATE"),
        );
      const undone: typeof changes = [];
      let current: (typeof changes)[number] | undefined;
      // Put the applied values back on what was already reverted, then the APPLIED
      // status, and return the suggestions the reverted writes outdated to the queue.
      const restore = async (reverted: typeof changes) => {
        for (const change of [...reverted].reverse()) {
          const entity = entities.get(
            entityKey(change.entityType, change.entityId as string),
          );
          if (!entity || change.operation === "CREATE") continue;
          const outcome = await settleOutcome(
            updateEntity(ctx, change.entityType, entity.id, entity.payload),
          );
          if (!outcome.success) {
            console.error(
              `Content review revert rollback failed for ${change.entityType} ${entity.id}: ${outcome.message}`,
            );
          }
        }
        await updateContentProposalForRestore(ctx.drizzle, appliedAt, proposal);
        await reinstateProposalsFor(
          ctx.drizzle,
          targetRefs([{ changes: reverted }]),
          startedAt,
        );
      };
      try {
        for (const change of ordered) {
          current = change;
          const entity = entities.get(
            entityKey(change.entityType, change.entityId as string),
          );
          if (!entity) continue;
          const outcome =
            change.operation === "CREATE"
              ? await deleteEntity(ctx, change.entityType, entity.id)
              : await updateEntity(ctx, change.entityType, entity.id, {
                  ...entity.payload,
                  ...Object.fromEntries(
                    Object.keys(change.applied ?? {}).map((field) => [
                      field,
                      change.before[field] ?? null,
                    ]),
                  ),
                });
          if (!outcome.success) {
            await restore(undone);
            return errorResponse(
              `${ENTITY_LABELS[change.entityType]}: ${outcome.message}`,
            );
          }
          undone.push(change);
          current = undefined;
        }
      } catch (error) {
        // An update that threw may have written its row already; restoring it is harmless.
        await restore(current ? [...undone, current] : undone);
        throw error;
      }
      await reinstateProposalsFor(ctx.drizzle, targetRefs([{ changes }]), appliedAt);
      return { success: true, message: "Reverted. The previous values are back." };
    }),

  /** Submission cohorts within retention, counted once per suggestion across entity changes. */
  getStats: protectedProcedure
    .input(reviewStatsSchema)
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      const now = new Date();
      if (!canChangeContent(user.role)) return buildReviewStats([], input, now);
      const proposals = await listContentProposalForGetStats(ctx.drizzle, input, now);
      return buildReviewStats(proposals, input, now);
    }),

  /**
   * Epidemic Sound search for the SFX picker; results play through
   * /api/content-review/sfx-preview. `configured` is false for anyone who cannot review
   * and when no API key is set.
   */
  searchSfx: protectedProcedure.input(sfxSearchSchema).query(async ({ ctx, input }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!canChangeContent(user.role)) return { configured: false, results: [] };
    if (!isEpidemicConfigured()) return { configured: false, results: [] };
    return {
      configured: true,
      results: await searchEpidemicSfx(input.term, CONTENT_REVIEW_SFX_SEARCH_RESULTS),
    };
  }),

  /**
   * Copy an Epidemic Sound effect into the asset library so an effect can use it. A sound
   * the library already holds is returned as it is.
   */
  importSfx: protectedProcedure
    .input(sfxImportSchema)
    .output(baseServerResponse.extend({ assetId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      if (!isEpidemicConfigured())
        return errorResponse("Sound search is not configured");
      const { asset, created } = await importEpidemicSfx(
        ctx.drizzle,
        ctx.userId,
        input,
      );
      return {
        success: true,
        message: created
          ? `Added ${asset.name} to the asset library`
          : `${asset.name} is already in the asset library`,
        assetId: asset.id,
      };
    }),
});

/**
 * Apply a pending suggestion through each entity's own update or create procedure, as
 * the reviewer, so the guards, ActionLog entry and Discord post of a manual save apply
 * unchanged. All changes are validated before the first write, the claim is a
 * compare-and-swap on the PENDING status, and a failure part way rolls back.
 */
const applyProposal = async (
  ctx: CallerContext & { userId: string },
  user: UserData,
  proposal: Proposal,
  choices: ApproveProposalInput,
): Promise<Outcome> => {
  if (user.isBanned)
    return errorResponse("You are banned and cannot perform this action");
  if (!canChangeContent(user.role))
    return errorResponse("Only content staff can approve suggestions");
  if (proposal.status !== "PENDING") {
    return errorResponse(`This suggestion is already ${proposal.status.toLowerCase()}`);
  }
  if (
    choices.expectedStatusChangedAt &&
    choices.expectedStatusChangedAt !== proposal.statusChangedAt.toISOString()
  ) {
    return errorResponse(
      "This suggestion was refined. Reload and review the revised draft before deciding.",
    );
  }
  const entities = await loadEntities(ctx.drizzle, [
    ...targetRefs([proposal]),
    ...proposal.basis,
  ]);
  const outdated = await refreshProposalFreshness(ctx.drizzle, [proposal], entities);
  const staleReason = outdated.get(proposal.id);
  if (staleReason)
    return errorResponse(`This suggestion went out of date: ${staleReason}`);
  const chosen = new Set(choices.media.map((media) => media.mediaId));
  const plans: {
    change: Proposal["changes"][number];
    entity: ContentEntity | undefined;
    fields: Record<string, unknown>;
    editable: Record<string, unknown>;
  }[] = [];
  const assets: (typeof gameAsset.$inferInsert)[] = [];
  const chosenMedia: string[] = [];
  for (const change of proposal.changes) {
    const config = ENTITY_CONFIG[change.entityType];
    const entity = entityOfChange(entities, change);
    if (change.operation === "UPDATE" && !entity) {
      return errorResponse(
        `${ENTITY_LABELS[change.entityType]} ${change.entityId} no longer exists`,
      );
    }
    const excluded = new Set(
      choices.exclude
        .filter((entry) => entry.changeId === change.id)
        .map((entry) => entry.field),
    );
    let fields = Object.fromEntries(
      Object.entries(change.after).filter(([field]) => !excluded.has(field)),
    );
    for (const edit of choices.edits) {
      if (edit.changeId === change.id && edit.field in fields)
        fields[edit.field] = edit.value;
    }
    const candidatesByPath = new Map<string, Proposal["media"]>();
    for (const media of proposal.media.filter(
      (entry) => entry.changeId === change.id,
    )) {
      candidatesByPath.set(media.path, [
        ...(candidatesByPath.get(media.path) ?? []),
        media,
      ]);
    }
    for (const [path, candidates] of candidatesByPath) {
      const field = topLevelField(path);
      const pick = candidates.find((media) => chosen.has(media.id)) ?? candidates[0];
      if (!(field in fields) || !pick) continue;
      const { value, asset } = materializeChoice(pick, ctx.userId);
      fields = {
        ...fields,
        [field]: setAtPath({ [field]: fields[field] }, path, value)[field],
      };
      if (asset) assets.push(asset);
      chosenMedia.push(pick.id);
    }
    if (Object.keys(fields).length === 0) continue;
    const editable = normalizeEditable(change.entityType, {
      ...(entity?.editable ?? {}),
      ...fields,
    });
    const invalid = validationError(
      config.validator,
      entity ? { ...entity.payload, ...editable } : editable,
    );
    if (invalid)
      return errorResponse(
        `${ENTITY_LABELS[change.entityType]} would be invalid: ${invalid}`,
      );
    plans.push({ change, entity, fields, editable });
  }
  if (plans.length === 0) return errorResponse("Tick at least one change to apply");
  // Suggestions this approval outdates from here on come back if it is undone.
  const startedAt = new Date();
  const claim = await updateContentProposalForApplyProposal(ctx.drizzle, ctx, proposal);
  if (claim.rowsAffected !== 1) {
    return errorResponse(
      "This suggestion was decided or went out of date a moment ago",
    );
  }
  const done: { plan: (typeof plans)[number]; entityId: string }[] = [];
  let added: (typeof gameAsset.$inferInsert)[] = [];
  let current: (typeof plans)[number] | undefined;
  // Whatever stops the approval part way, a refusal or a throw, undoes what it wrote.
  try {
    // An Epidemic sound picked before, or by a simultaneous approval, is already in the
    // library and stays as it is; only rows this approval inserted are removed on failure.
    const inserted = await Promise.all(
      assets.map(async (asset) => {
        const result = await insertGameAssetIfAbsent(ctx.drizzle, asset);
        return result.rowsAffected === 1 ? [asset] : [];
      }),
    );
    added = inserted.flat();
    for (const plan of plans) {
      current = plan;
      const type = plan.change.entityType;
      // The payload was read before the claim, so an editor save landing in between is
      // overwritten, as two editor saves overwrite each other. The ActionLog keeps both, and
      // the freshness check above has already refused anything edited earlier.
      const outcome: Outcome & { id?: string } = plan.entity
        ? await updateEntity(ctx, type, plan.entity.id, {
            ...plan.entity.payload,
            ...plan.editable,
          })
        : await createEntity(ctx, type, plan.editable);
      const entityId = plan.entity?.id ?? outcome.id;
      if (!outcome.success || !entityId) {
        await rollback(ctx, proposal.id, done, added, startedAt);
        return errorResponse(`${ENTITY_LABELS[type]}: ${outcome.message}`);
      }
      done.push({ plan, entityId });
      current = undefined;
    }
    // What the entities' updates stored, after their validators trimmed and sorted it, is
    // what revert later compares the live rows against.
    const saved = await loadEntities(
      ctx.drizzle,
      done.map(({ plan, entityId }) => ({
        entityType: plan.change.entityType,
        entityId,
      })),
    );
    await Promise.all([
      ...done.map(({ plan, entityId }) => {
        const stored = saved.get(entityKey(plan.change.entityType, entityId))?.editable;
        const applied = Object.fromEntries(
          Object.keys(plan.fields).map((field) => [
            field,
            stored && field in stored ? stored[field] : plan.fields[field],
          ]),
        );
        return updateContentProposalChangeForApplyProposal(
          ctx.drizzle,
          applied,
          entityId,
          plan,
        );
      }),
      chosenMedia.length
        ? updateContentProposalMediaForApplyProposal(ctx.drizzle, chosenMedia)
        : null,
    ]);
  } catch (error) {
    // An update that threw may have written its row already; restoring it is harmless.
    const partial = current?.entity
      ? [{ plan: current, entityId: current.entity.id }]
      : [];
    await rollback(ctx, proposal.id, [...done, ...partial], added, startedAt);
    throw error;
  }
  const names = done.map(({ plan }) => plan.entity?.name ?? "a new entry").join(", ");
  return { success: true, message: `Applied to ${names}` };
};

/**
 * Undo the writes of a failed approval and hand the suggestion back to the queue: updated
 * entities get their earlier payload back, while created entities and the assets the
 * approval added are deleted. A failed step is logged, not thrown, so the rest still runs.
 */
const rollback = async (
  ctx: CallerContext & { userId: string },
  proposalId: string,
  done: {
    plan: { change: { entityType: ContentProposalEntityType }; entity?: ContentEntity };
    entityId: string;
  }[],
  assets: (typeof gameAsset.$inferInsert)[],
  startedAt: Date,
) => {
  for (const { plan, entityId } of [...done].reverse()) {
    const type = plan.change.entityType;
    const outcome = await settleOutcome(
      plan.entity
        ? updateEntity(ctx, type, entityId, plan.entity.payload)
        : deleteEntity(ctx, type, entityId),
    );
    if (!outcome.success) {
      console.error(
        `Content review rollback failed for ${type} ${entityId}: ${outcome.message}`,
      );
    }
  }
  await Promise.all([
    assets.length ? deleteGameAssetForRollback(ctx.drizzle, assets) : null,
    updateContentProposalForRollback(ctx.drizzle, proposalId),
  ]);
  // The entities' own updates outdated the other suggestions resting on them.
  await reinstateProposalsFor(
    ctx.drizzle,
    done.map(({ plan, entityId }) => ({
      entityType: plan.change.entityType,
      entityId,
    })),
    startedAt,
  );
};

/**
 * Editable fields as the entity's update stores them: its validator fills in defaults (an
 * effect's `dmgModifier`, for example) and trims text. Revert compares these forms, so a
 * value the save itself completed never reads as somebody else's edit.
 */
const storedEditable = (
  type: ContentProposalEntityType,
  payload: Record<string, unknown>,
) => {
  const parsed = ENTITY_CONFIG[type].validator.safeParse(payload);
  const stored = parsed.success ? (parsed.data as Record<string, unknown>) : payload;
  return normalizeEditable(type, editableOf(type, stored));
};

/** Save `data`, the entity's whole editor payload, through its own update procedure. */
const updateEntity = (
  ctx: CallerContext,
  type: ContentProposalEntityType,
  id: string,
  data: Record<string, unknown>,
): Promise<Outcome> => {
  switch (type) {
    case "JUTSU":
      return jutsuRouter
        .createCaller(ctx)
        .update({ id, data: data as z.input<typeof JutsuValidator> });
    case "ITEM":
      return itemRouter
        .createCaller(ctx)
        .update({ id, data: data as z.input<typeof ItemValidator> });
    case "BLOODLINE":
      return bloodlineRouter
        .createCaller(ctx)
        .update({ id, data: data as z.input<typeof BloodlineValidator> });
    case "QUEST":
      return questsRouter
        .createCaller(ctx)
        .update({ id, data: data as z.input<typeof QuestValidator> });
    case "BADGE":
      return badgeRouter
        .createCaller(ctx)
        .update({ id, data: data as z.input<typeof BadgeValidator> });
    case "TITLE":
      return titleRouter
        .createCaller(ctx)
        .update({ id, data: data as z.input<typeof TitleValidator> });
    case "GAME_ASSET":
      return gameAssetRouter
        .createCaller(ctx)
        .update({ id, data: data as z.input<typeof gameAssetValidator> });
    case "AI":
      return profileRouter
        .createCaller(ctx)
        .updateAi({ id, data: data as z.input<typeof insertAiSchema> });
  }
};

/**
 * New content goes through the entity's own create (a placeholder row) and then its update,
 * exactly like pressing "New" and then "Save" in the manual. The placeholder is deleted
 * again when the update fails or throws; on success the result carries the new id.
 */
const createEntity = async (
  ctx: CallerContext,
  type: ContentProposalEntityType,
  editable: Record<string, unknown>,
): Promise<Outcome & { id?: string }> => {
  const created = await (() => {
    switch (type) {
      case "JUTSU":
        return jutsuRouter.createCaller(ctx).create();
      case "ITEM": {
        return itemRouter
          .createCaller(ctx)
          .create({ type: editable.itemType as ItemType });
      }
      case "BLOODLINE":
        return bloodlineRouter.createCaller(ctx).create();
      case "QUEST":
        return questsRouter.createCaller(ctx).create();
      case "BADGE":
        return badgeRouter.createCaller(ctx).create();
      case "TITLE":
        return titleRouter.createCaller(ctx).create();
      case "GAME_ASSET":
        return gameAssetRouter.createCaller(ctx).create();
      case "AI":
        return profileRouter.createCaller(ctx).create();
    }
  })();
  if (!created.success) return created;
  // Every create procedure answers with the new row's id as its message.
  const id = created.message;
  const entity = (
    await loadEntities(ctx.drizzle, [{ entityType: type, entityId: id }])
  ).get(entityKey(type, id));
  if (!entity) {
    await discardPlaceholder(ctx, type, id);
    return { success: false, message: "The new entry could not be loaded" };
  }
  const updated = await updateEntity(ctx, type, id, {
    ...entity.payload,
    ...editable,
  }).catch(async (error: unknown) => {
    await discardPlaceholder(ctx, type, id);
    throw error;
  });
  if (!updated.success) {
    await discardPlaceholder(ctx, type, id);
    return updated;
  }
  return { ...updated, id };
};

/**
 * Delete the placeholder a failed create left behind. A failure to delete it is logged, not
 * thrown, so it never hides the error that made the create fail.
 */
const discardPlaceholder = async (
  ctx: CallerContext,
  type: ContentProposalEntityType,
  id: string,
) => {
  const outcome = await settleOutcome(deleteEntity(ctx, type, id));
  if (!outcome.success) {
    console.error(
      `Content review could not delete placeholder ${type} ${id}: ${outcome.message}`,
    );
  }
};

/** Reports a thrown procedure as a failed outcome, so cleanup keeps going. */
const settleOutcome = (outcome: Promise<Outcome>): Promise<Outcome> =>
  outcome.catch((error: unknown) => ({
    success: false,
    message: error instanceof Error ? clientErrorMessage(error) : String(error),
  }));

/** Delete an entity through its own delete procedure. */
const deleteEntity = (
  ctx: CallerContext,
  type: ContentProposalEntityType,
  id: string,
): Promise<Outcome> => {
  switch (type) {
    case "JUTSU":
      return jutsuRouter.createCaller(ctx).delete({ id });
    case "ITEM":
      return itemRouter.createCaller(ctx).delete({ id });
    case "BLOODLINE":
      return bloodlineRouter.createCaller(ctx).delete({ id });
    case "QUEST":
      return questsRouter.createCaller(ctx).delete({ id });
    case "BADGE":
      return badgeRouter.createCaller(ctx).delete({ id });
    case "TITLE":
      return titleRouter.createCaller(ctx).archive({ id });
    case "GAME_ASSET":
      return gameAssetRouter.createCaller(ctx).delete({ id });
    case "AI":
      return profileRouter.createCaller(ctx).delete({ id });
  }
};

/** The loaded entity a change targets; a new entry has none yet. */
const entityOfChange = <T>(
  entities: Map<string, T>,
  change?: { entityType: ContentProposalEntityType; entityId: string | null },
) =>
  change?.entityId
    ? entities.get(entityKey(change.entityType, change.entityId))
    : undefined;

/**
 * References to the entities the changes of these suggestions target, leaving out new
 * entries that have no id yet.
 */
const targetRefs = (
  proposals: {
    changes: { entityType: ContentProposalEntityType; entityId: string | null }[];
  }[],
) =>
  proposals.flatMap((proposal) =>
    proposal.changes.flatMap((change) =>
      change.entityId
        ? [{ entityType: change.entityType, entityId: change.entityId }]
        : [],
    ),
  );

/**
 * A suggestion as a queue card: its metadata, the author's and reviewer's names, and one
 * entry per change with the live name and image of the entity it targets.
 */
const toSummary = (
  row: Pick<
    Proposal,
    | "id"
    | "title"
    | "category"
    | "status"
    | "source"
    | "agentName"
    | "runUrl"
    | "focus"
    | "confidence"
    | "createdAt"
    | "statusChangedAt"
    | "expiresAt"
    | "rejectReason"
    | "reviewNote"
    | "outdatedReason"
    | "changes"
  > & {
    createdBy: { username: string } | null;
    reviewedBy: { username: string } | null;
  },
  entities: Map<string, ContentEntity>,
) => ({
  id: row.id,
  title: row.title,
  category: row.category,
  status: row.status,
  source: row.source,
  agentName: row.agentName,
  runUrl: row.runUrl,
  focus: row.focus,
  confidence: row.confidence,
  createdAt: row.createdAt,
  statusChangedAt: row.statusChangedAt,
  expiresAt: row.expiresAt,
  rejectReason: row.rejectReason,
  reviewNote: row.reviewNote,
  outdatedReason: row.outdatedReason,
  createdBy: row.createdBy?.username ?? null,
  reviewedBy: row.reviewedBy?.username ?? null,
  targets: row.changes.map((change) => {
    const entity = entityOfChange(entities, change);
    return {
      entityType: change.entityType,
      entityId: change.entityId,
      operation: change.operation,
      label: ENTITY_LABELS[change.entityType],
      name: entity?.name ?? (draftName(change.after) || "New"),
      image: entity?.image ?? null,
      fields: Object.keys(change.after),
    };
  }),
});

type Proposal = NonNullable<Awaited<ReturnType<typeof fetchProposal>>>;

/**
 * Request context a server-side caller of another router is built from. `createCaller`
 * also accepts a factory function, which this type leaves out.
 */
type CallerContext = Exclude<
  Parameters<typeof jutsuRouter.createCaller>[0],
  (...args: never[]) => unknown
>;

/** The `baseServerResponse` the entity procedures answer with. */
type Outcome = { success: boolean; message: string };
