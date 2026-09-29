import { and, asc, count, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import type {
  ContentProposalCategory,
  ContentProposalEntityType,
  ContentProposalStatus,
  ItemType,
} from "@/drizzle/constants";
import { ItemTypes } from "@/drizzle/constants";
import type { insertAiSchema, UserData } from "@/drizzle/schema";
import {
  contentProposal,
  contentProposalChange,
  contentProposalMedia,
  gameAsset,
} from "@/drizzle/schema";
import {
  type ContentEntity,
  draftName,
  ENTITY_CONFIG,
  entityKey,
  loadEntities,
} from "@/libs/contentReview/entities";
import { isEpidemicConfigured, searchEpidemicSfx } from "@/libs/contentReview/epidemic";
import { importEpidemicSfx, materializeChoice } from "@/libs/contentReview/media";
import {
  refreshProposalFreshness,
  reinstateProposalsFor,
} from "@/libs/contentReview/outdate";
import { getAtPath, setAtPath, topLevelField } from "@/libs/contentReview/paths";
import {
  createStaffProposal,
  normalizeEditable,
  validationError,
} from "@/libs/contentReview/submit";
import { sameValue } from "@/libs/contentReview/version";
import { gameAssetRouter } from "@/routers/asset";
import { badgeRouter } from "@/routers/badge";
import { bloodlineRouter } from "@/routers/bloodline";
import { itemRouter } from "@/routers/item";
import { jutsuRouter } from "@/routers/jutsu";
import { fetchUser, profileRouter } from "@/routers/profile";
import { questsRouter } from "@/routers/quests";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
} from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import type { gameAssetValidator } from "@/validators/asset";
import type { BadgeValidator } from "@/validators/badge";
import type {
  BloodlineValidator,
  ItemValidator,
  JutsuValidator,
} from "@/validators/combat";
import {
  type ApproveProposalInput,
  approveProposalSchema,
  bulkApproveSchema,
  proposalIdSchema,
  rejectProposalSchema,
  reviewQueueSchema,
  reviewStatsSchema,
  sfxImportSchema,
  sfxSearchSchema,
  staffCreateProposalSchema,
} from "@/validators/contentReview";
import type { QuestValidator } from "@/validators/objectives";

export const contentReviewRouter = createTRPCRouter({
  /** One page of a tab in the review desk. Staff who cannot review see their own suggestions. */
  getQueue: protectedProcedure
    .input(reviewQueueSchema)
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!isStaffRole(user.role))
        return { items: [], nextCursor: null, canReview: false };
      const canReview = canChangeContent(user.role);
      const offset = input.cursor ?? 0;
      const rows = await ctx.drizzle.query.contentProposal.findMany({
        where: and(
          eq(contentProposal.status, input.status),
          input.category ? eq(contentProposal.category, input.category) : undefined,
          input.source ? eq(contentProposal.source, input.source) : undefined,
          input.entityType
            ? inArray(
                contentProposal.id,
                ctx.drizzle
                  .select({ id: contentProposalChange.proposalId })
                  .from(contentProposalChange)
                  .where(eq(contentProposalChange.entityType, input.entityType)),
              )
            : undefined,
          canReview ? undefined : eq(contentProposal.createdByUserId, ctx.userId),
        ),
        with: {
          changes: true,
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
      };
    }),

  /** Tab counts for the desk and the notification pill. */
  getCounts: protectedProcedure.query(async ({ ctx }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    const canReview = canChangeContent(user.role);
    const scope = canReview
      ? undefined
      : eq(contentProposal.createdByUserId, ctx.userId);
    const [byStatus, byCategory] = await Promise.all([
      ctx.drizzle
        .select({ status: contentProposal.status, n: count() })
        .from(contentProposal)
        .where(scope)
        .groupBy(contentProposal.status),
      ctx.drizzle
        .select({ category: contentProposal.category, n: count() })
        .from(contentProposal)
        .where(and(eq(contentProposal.status, "PENDING"), scope))
        .groupBy(contentProposal.category),
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

  /** Everything the desk shows for one suggestion, with live values for the preview. */
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
      const outdated =
        proposal.status === "PENDING" && canReview
          ? await refreshProposalFreshness(ctx.drizzle, [proposal])
          : new Map<string, string>();
      const entities = await loadEntities(ctx.drizzle, [
        ...targetRefs([proposal]),
        ...proposal.basis.map((basis) => ({
          entityType: basis.entityType,
          entityId: basis.entityId,
        })),
      ]);
      const status = outdated.has(proposal.id) ? "OUTDATED" : proposal.status;
      // Assets the media comparisons show: every catalog candidate and the asset each media
      // field points at today.
      const currentAt = (changeId: string, path: string) => {
        const change = proposal.changes.find((entry) => entry.id === changeId);
        const entity = change?.entityId
          ? entities.get(entityKey(change.entityType, change.entityId))
          : undefined;
        const value = entity ? getAtPath(entity.editable, path) : undefined;
        return typeof value === "string" && value ? value : null;
      };
      const assetIds = new Set(
        proposal.media.flatMap((media) => [
          ...(media.source === "CATALOG" && media.externalId ? [media.externalId] : []),
          ...(media.kind !== "IMAGE"
            ? [currentAt(media.changeId, media.path) ?? ""]
            : []),
        ]),
      );
      assetIds.delete("");
      const assets = assetIds.size
        ? await ctx.drizzle
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
            .where(inArray(gameAsset.id, [...assetIds]))
        : [];
      return {
        ...toSummary({ ...proposal, status }, entities),
        outdatedReason: outdated.get(proposal.id) ?? proposal.outdatedReason,
        rationale: proposal.rationale,
        canReview,
        changes: proposal.changes.map((change) => {
          const entity = change.entityId
            ? entities.get(entityKey(change.entityType, change.entityId))
            : undefined;
          const config = ENTITY_CONFIG[change.entityType];
          return {
            id: change.id,
            entityType: change.entityType,
            entityId: change.entityId,
            operation: change.operation,
            label: config.label,
            name: entity?.name ?? (draftName(change.after) || "New"),
            detailHref: change.entityId ? config.detailHref(change.entityId) : null,
            before: change.before,
            after: change.after,
            applied: change.applied,
            current: entity
              ? Object.fromEntries(
                  Object.keys(change.after).map((field) => [
                    field,
                    entity.editable[field] ?? null,
                  ]),
                )
              : null,
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
                prompt: media.prompt,
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
            label: ENTITY_CONFIG[basis.entityType].label,
            name: entity?.name ?? basis.entityId,
            version: basis.version,
            fresh: entity?.version === basis.version,
          };
        }),
        assets: Object.fromEntries(assets.map((asset) => [asset.id, asset])),
      };
    }),

  /** A staff suggestion from an editor form or content card. */
  create: protectedProcedure
    .input(staffCreateProposalSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!isStaffRole(user.role))
        return errorResponse("Only staff can suggest content changes");
      const result = await createStaffProposal(ctx.drizzle, ctx.userId, input);
      if (!result.ok) return errorResponse(result.reason);
      return { success: true, message: "Sent for review" };
    }),

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

  /** Approve several suggestions with their defaults: every field, first media candidate. */
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

  reject: protectedProcedure
    .input(rejectProposalSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      const result = await ctx.drizzle
        .update(contentProposal)
        .set({
          status: "REJECTED",
          rejectReason: input.reason,
          reviewNote: input.note?.trim() || null,
          reviewedByUserId: ctx.userId,
          statusChangedAt: new Date(),
        })
        .where(
          and(eq(contentProposal.id, input.id), eq(contentProposal.status, "PENDING")),
        );
      if (result.rowsAffected !== 1) {
        return errorResponse("This suggestion was already decided or went out of date");
      }
      return { success: true, message: "Rejected. The next audit reads your reason." };
    }),

  /**
   * Put the previous values back. Refused when someone edited the entity after the
   * suggestion was applied, since writing old values would silently undo their edit.
   */
  revert: protectedProcedure
    .input(proposalIdSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, proposal] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        fetchProposal(ctx.drizzle, input.id),
      ]);
      if (!canChangeContent(user.role)) return errorResponse("Not allowed");
      if (!proposal) return errorResponse("Suggestion not found");
      if (proposal.status !== "APPLIED")
        return errorResponse("Only applied suggestions can be reverted");
      const changes = proposal.changes.filter(
        (change) => change.applied && change.entityId,
      );
      const entities = await loadEntities(ctx.drizzle, targetRefs([{ changes }]));
      for (const change of changes) {
        const entity = entities.get(
          entityKey(change.entityType, change.entityId as string),
        );
        const label = ENTITY_CONFIG[change.entityType].label;
        if (!entity) {
          if (change.operation === "CREATE") continue;
          return errorResponse(`${label} ${change.entityId} no longer exists`);
        }
        const applied = change.applied ?? {};
        const edited = Object.keys(applied).some(
          (field) => !sameValue(entity.editable[field], applied[field]),
        );
        if (edited) {
          return errorResponse(
            `${label} ${entity.name} was edited after this suggestion was applied, so it cannot be reverted automatically`,
          );
        }
      }
      const claim = await ctx.drizzle
        .update(contentProposal)
        .set({ status: "REVERTED", statusChangedAt: new Date() })
        .where(
          and(
            eq(contentProposal.id, proposal.id),
            eq(contentProposal.status, "APPLIED"),
          ),
        );
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
      // Put the applied values back on what was already reverted, and the status with them.
      const restore = async (reverted: typeof changes) => {
        for (const change of [...reverted].reverse()) {
          const entity = entities.get(
            entityKey(change.entityType, change.entityId as string),
          );
          if (!entity || change.operation === "CREATE") continue;
          const outcome = await updateEntity(
            ctx,
            change.entityType,
            entity.id,
            entity.payload,
          ).catch((error: unknown) => ({
            success: false,
            message: error instanceof Error ? error.message : String(error),
          }));
          if (!outcome.success) {
            console.error(
              `Content review revert rollback failed for ${change.entityType} ${entity.id}: ${outcome.message}`,
            );
          }
        }
        await ctx.drizzle
          .update(contentProposal)
          .set({ status: "APPLIED" })
          .where(eq(contentProposal.id, proposal.id));
        await reinstateProposalsFor(ctx.drizzle, refsOf(reverted), startedAt);
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
              `${ENTITY_CONFIG[change.entityType].label}: ${outcome.message}`,
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
      return { success: true, message: "Reverted. The previous values are back." };
    }),

  /** Decisions per source, agent and category over the retention window. */
  getStats: protectedProcedure
    .input(reviewStatsSchema)
    .query(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
      if (!canChangeContent(user.role)) return [];
      return ctx.drizzle
        .select({
          source: contentProposal.source,
          agentName: contentProposal.agentName,
          category: contentProposal.category,
          status: contentProposal.status,
          n: count(),
        })
        .from(contentProposal)
        .where(
          gte(
            contentProposal.createdAt,
            new Date(Date.now() - input.days * 86_400_000),
          ),
        )
        .groupBy(
          contentProposal.source,
          contentProposal.agentName,
          contentProposal.category,
          contentProposal.status,
        );
    }),

  /** Epidemic Sound search for the SFX picker; results play through /api/content-review/sfx-preview. */
  searchSfx: protectedProcedure.input(sfxSearchSchema).query(async ({ ctx, input }) => {
    const user = await fetchUser(ctx.drizzle, ctx.userId);
    if (!canChangeContent(user.role)) return { configured: false, results: [] };
    if (!isEpidemicConfigured()) return { configured: false, results: [] };
    return { configured: true, results: await searchEpidemicSfx(input.term, 12) };
  }),

  /** Copy an Epidemic Sound effect into the asset library so an effect can use it. */
  importSfx: protectedProcedure
    .input(sfxImportSchema)
    .output(baseServerResponse.extend({ assetId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const user = await fetchUser(ctx.drizzle, ctx.userId);
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

type Proposal = NonNullable<Awaited<ReturnType<typeof fetchProposal>>>;
/** The request context a caller is built from; createCaller also accepts a factory. */
type Caller = Exclude<
  Parameters<typeof jutsuRouter.createCaller>[0],
  (...args: never[]) => unknown
>;
type Outcome = { success: boolean; message: string };

/**
 * Apply a pending suggestion through the entity's own update procedure, as the reviewer, so
 * every guard, the ActionLog entry and the Discord post of a manual save apply unchanged.
 * The claim is a compare-and-swap on the status; a failed write releases it again.
 */
const applyProposal = async (
  ctx: Caller & { userId: string },
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
  const outdated = await refreshProposalFreshness(ctx.drizzle, [proposal]);
  const staleReason = outdated.get(proposal.id);
  if (staleReason)
    return errorResponse(`This suggestion went out of date: ${staleReason}`);
  const entities = await loadEntities(ctx.drizzle, targetRefs([proposal]));
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
    const entity = change.entityId
      ? entities.get(entityKey(change.entityType, change.entityId))
      : undefined;
    if (change.operation === "UPDATE" && !entity) {
      return errorResponse(`${config.label} ${change.entityId} no longer exists`);
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
    if (invalid) return errorResponse(`${config.label} would be invalid: ${invalid}`);
    plans.push({ change, entity, fields, editable });
  }
  if (plans.length === 0) return errorResponse("Tick at least one change to apply");
  // Suggestions this approval outdates from here on come back if it is undone.
  const startedAt = new Date();
  const claim = await ctx.drizzle
    .update(contentProposal)
    .set({
      status: "APPLIED",
      reviewedByUserId: ctx.userId,
      statusChangedAt: new Date(),
    })
    .where(
      and(eq(contentProposal.id, proposal.id), eq(contentProposal.status, "PENDING")),
    );
  if (claim.rowsAffected !== 1) {
    return errorResponse("Someone else decided on this suggestion a moment ago");
  }
  const done: { plan: (typeof plans)[number]; entityId: string }[] = [];
  let added: (typeof gameAsset.$inferInsert)[] = [];
  let current: (typeof plans)[number] | undefined;
  // Whatever stops the approval part way, a refusal or a throw, undoes what it wrote.
  try {
    // An Epidemic sound picked before is already in the library; only new assets are
    // added, and only those are removed again when applying fails.
    const known = assets.length
      ? await ctx.drizzle
          .select({ id: gameAsset.id })
          .from(gameAsset)
          .where(
            inArray(
              gameAsset.id,
              assets.map((asset) => asset.id),
            ),
          )
      : [];
    const fresh = assets.filter((asset) => !known.some((row) => row.id === asset.id));
    if (fresh.length > 0) await ctx.drizzle.insert(gameAsset).values(fresh);
    added = fresh;
    for (const plan of plans) {
      current = plan;
      const type = plan.change.entityType;
      const outcome: Outcome & { id?: string } = plan.entity
        ? await updateEntity(ctx, type, plan.entity.id, {
            ...plan.entity.payload,
            ...plan.editable,
          })
        : await createEntity(ctx, type, plan.editable);
      const entityId = plan.entity?.id ?? outcome.id;
      if (!outcome.success || !entityId) {
        await rollback(ctx, proposal.id, done, added, startedAt);
        return errorResponse(`${ENTITY_CONFIG[type].label}: ${outcome.message}`);
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
        return ctx.drizzle
          .update(contentProposalChange)
          .set({ applied, entityId })
          .where(eq(contentProposalChange.id, plan.change.id));
      }),
      chosenMedia.length
        ? ctx.drizzle
            .update(contentProposalMedia)
            .set({ chosen: true })
            .where(inArray(contentProposalMedia.id, chosenMedia))
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

/** Undo the writes of a failed approval and hand the suggestion back to the queue. */
const rollback = async (
  ctx: Caller & { userId: string },
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
    const outcome = await (plan.entity
      ? updateEntity(ctx, type, entityId, plan.entity.payload)
      : deleteEntity(ctx, type, entityId)
    ).catch((error: unknown) => ({
      success: false,
      message: error instanceof Error ? error.message : String(error),
    }));
    if (!outcome.success) {
      console.error(
        `Content review rollback failed for ${type} ${entityId}: ${outcome.message}`,
      );
    }
  }
  await Promise.all([
    assets.length
      ? ctx.drizzle.delete(gameAsset).where(
          inArray(
            gameAsset.id,
            assets.map((asset) => asset.id),
          ),
        )
      : null,
    ctx.drizzle
      .update(contentProposal)
      .set({ status: "PENDING", reviewedByUserId: null, statusChangedAt: new Date() })
      .where(eq(contentProposal.id, proposalId)),
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

const refsOf = (
  changes: { entityType: ContentProposalEntityType; entityId: string | null }[],
) =>
  changes.flatMap((change) =>
    change.entityId
      ? [{ entityType: change.entityType, entityId: change.entityId }]
      : [],
  );

const updateEntity = (
  ctx: Caller,
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
 * exactly like pressing "New" and then "Save" in the manual.
 */
const createEntity = async (
  ctx: Caller,
  type: ContentProposalEntityType,
  editable: Record<string, unknown>,
): Promise<Outcome & { id?: string }> => {
  const created = await (() => {
    switch (type) {
      case "JUTSU":
        return jutsuRouter.createCaller(ctx).create();
      case "ITEM": {
        const itemType = ItemTypes.includes(editable.itemType as ItemType)
          ? (editable.itemType as ItemType)
          : "WEAPON";
        return itemRouter.createCaller(ctx).create({ type: itemType });
      }
      case "BLOODLINE":
        return bloodlineRouter.createCaller(ctx).create();
      case "QUEST":
        return questsRouter.createCaller(ctx).create();
      case "BADGE":
        return badgeRouter.createCaller(ctx).create();
      case "GAME_ASSET":
        return gameAssetRouter.createCaller(ctx).create();
      case "AI":
        return profileRouter.createCaller(ctx).create();
    }
  })();
  if (!created.success) return created;
  const id = created.message;
  const entity = (
    await loadEntities(ctx.drizzle, [{ entityType: type, entityId: id }])
  ).get(entityKey(type, id));
  if (!entity) return { success: false, message: "The new entry could not be loaded" };
  const updated = await updateEntity(ctx, type, id, {
    ...entity.payload,
    ...editable,
  }).catch(async (error: unknown) => {
    await deleteEntity(ctx, type, id);
    throw error;
  });
  if (!updated.success) {
    await deleteEntity(ctx, type, id);
    return updated;
  }
  return { ...updated, id };
};

const deleteEntity = (
  ctx: Caller,
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
    case "GAME_ASSET":
      return gameAssetRouter.createCaller(ctx).delete({ id });
    case "AI":
      return profileRouter.createCaller(ctx).delete({ id });
  }
};

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
    const entity = change.entityId
      ? entities.get(entityKey(change.entityType, change.entityId))
      : undefined;
    return {
      entityType: change.entityType,
      entityId: change.entityId,
      operation: change.operation,
      label: ENTITY_CONFIG[change.entityType].label,
      name: entity?.name ?? String(change.after.name ?? change.after.username ?? "New"),
      image: entity?.image ?? null,
      fields: Object.keys(change.after),
    };
  }),
});

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
