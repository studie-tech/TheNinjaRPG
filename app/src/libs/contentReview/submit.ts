import { and, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";
import {
  CONTENT_AUDIT_MAX_GENERATIONS,
  CONTENT_AUDIT_MAX_SOUND_SEARCHES,
  CONTENT_PROPOSAL_EVIDENCE_DAYS,
  CONTENT_PROPOSAL_RATIONALE_LENGTH,
  type ContentProposalEntityType,
} from "@/drizzle/constants";
import {
  contentProposal,
  contentProposalBasis,
  contentProposalChange,
  contentProposalMedia,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { DAY_S, secondsFromNow } from "@/utils/time";
import type {
  AgentProposal,
  AgentProposalRevision,
  AgentSubmission,
  StaffCreateProposal,
} from "@/validators/contentReview";
import {
  type ContentEntity,
  draftName,
  ENTITY_CONFIG,
  editableOf,
  entityKey,
  loadEntities,
} from "./entities";
import {
  collectCandidates,
  deleteStoredFiles,
  type MediaBudget,
  materializeChoice,
} from "./media";
import { isMediaPath, isSceneCharacterPath, topLevelField } from "./paths";
import {
  agentChangeViolation,
  applySetOperations,
  changedFields,
  type SetOperation,
} from "./rules";
import { sameValue } from "./version";

/**
 * Validate and store the audit's suggestions, accepting or refusing each on its own and
 * saving the accepted ones together. Every change is replayed against the live row: `before`
 * comes from the database, never from the model, and a basis version that no longer matches
 * means the snapshot was already stale, so the suggestion is refused.
 */
export const ingestAgentSubmission = async (
  client: DrizzleClient,
  submission: AgentSubmission,
): Promise<SubmissionResult> => {
  const refs = submission.proposals.flatMap((proposal) => [
    ...proposal.basis.map((basis) => ({
      entityType: basis.entityType,
      entityId: basis.entityId,
    })),
    ...proposal.changes.flatMap((change) =>
      change.entityId
        ? [{ entityType: change.entityType, entityId: change.entityId }]
        : [],
    ),
  ]);
  const targetIds = [...new Set(refs.map((ref) => ref.entityId))];
  // Names new content would take, read from its `set` up front so each type needs one query.
  const drafts = submission.proposals.flatMap((proposal) =>
    proposal.changes.flatMap((change) => {
      if (change.operation !== "CREATE") return [];
      const fields = Object.fromEntries(
        change.set.map((set) => [set.path, parsedJson(set.valueJson)]),
      );
      const name = draftName(fields);
      return name ? [{ entityType: change.entityType, name }] : [];
    }),
  );
  const [entities, open, rejected, names] = await Promise.all([
    loadEntities(client, refs),
    targetIds.length
      ? openTargets(client, targetIds)
      : Promise.resolve(new Set<string>()),
    targetIds.length ? rejectedChanges(client, targetIds) : Promise.resolve([]),
    drafts.length ? takenNames(client, drafts) : Promise.resolve(new Set<string>()),
  ]);
  const budget: MediaBudget = {
    searches: CONTENT_AUDIT_MAX_SOUND_SEARCHES,
    generations: CONTENT_AUDIT_MAX_GENERATIONS,
  };
  const result: SubmissionResult = { accepted: [], refused: [], summary: "" };
  const claimed = new Set<string>();
  const planned: Rows[] = [];
  for (const [index, proposal] of submission.proposals.entries()) {
    const refuse = (reason: string) =>
      result.refused.push({ index, title: proposal.title, reason });
    // Candidates copied to storage for a suggestion that is not kept are deleted again.
    const uploaded: string[] = [];
    const plan = await planAgentProposal(
      client,
      proposal,
      entities,
      budget,
      { open, rejected, claimed, names },
      uploaded,
    ).catch(async (error: unknown) => {
      // Nothing of this submission gets saved, so no suggestion keeps its files.
      await discardUploads([...uploaded, ...mediaKeys(planned)]);
      throw error;
    });
    if (typeof plan === "string") {
      await discardUploads(uploaded);
      refuse(plan);
      continue;
    }
    plan.proposal.agentName = submission.agentName;
    plan.proposal.runUrl = submission.runUrl ?? null;
    plan.proposal.focus = submission.focus ?? null;
    planned.push(plan);
    result.accepted.push({ index, id: plan.proposal.id, title: proposal.title });
  }
  await insertRows(client, planned).catch(async (error: unknown) => {
    await discardUploads(mediaKeys(planned));
    throw error;
  });
  result.summary = submissionSummary(submission, result);
  return result;
};

/** Fetch a draft and its current optimistic revision token without altering freshness. */
export const readAgentProposal = (client: DrizzleClient, id: string) =>
  client.query.contentProposal.findFirst({
    where: eq(contentProposal.id, id),
    with: { changes: true, basis: true, media: true },
  });

/**
 * Refine a suggestion without changing its identity or approving content. Media preparation
 * precedes a short transaction; the guarded parent write and replacement children commit
 * together, so concurrent staff decisions cannot consume a partially rewritten draft.
 */
export const reviseAgentProposal = async (
  client: DrizzleClient,
  id: string,
  input: AgentProposalRevision,
): Promise<
  | { ok: true; id: string; statusChangedAt: string }
  | { ok: false; status: number; reason: string }
> => {
  const existing = await readAgentProposal(client, id);
  if (!existing) return { ok: false, status: 404, reason: "Suggestion not found" };
  if (
    existing.source !== "AGENT" ||
    !["PENDING", "REJECTED", "OUTDATED"].includes(existing.status)
  ) {
    return {
      ok: false,
      status: 409,
      reason: "Only pending, rejected or outdated agent suggestions can be refined",
    };
  }
  if (existing.statusChangedAt.toISOString() !== input.expectedStatusChangedAt) {
    return {
      ok: false,
      status: 409,
      reason: "Suggestion changed; fetch it again before refining",
    };
  }
  if ((existing.status !== "PENDING") !== input.reactivate) {
    return {
      ok: false,
      status: 400,
      reason: "Rejected and outdated suggestions require explicit reactivation",
    };
  }
  if (existing.status === "REJECTED" && !input.feedbackResponse) {
    return {
      ok: false,
      status: 400,
      reason: "Explain how this revision addresses the staff rejection",
    };
  }
  const targets = (
    changes: { entityType: string; entityId: string | null; operation: string }[],
  ) =>
    changes
      .map((change) =>
        JSON.stringify([change.entityType, change.entityId, change.operation]),
      )
      .sort();
  if (!sameValue(targets(existing.changes), targets(input.proposal.changes))) {
    return {
      ok: false,
      status: 400,
      reason: "A revision must preserve every target and operation",
    };
  }
  // Retain only candidates from this exact revision and field. Their bytes have already
  // been inspected; a rationale-only refinement must not silently generate a new image.
  const retained = new Map<string, typeof existing.media>();
  for (const mediaId of new Set(input.retainMediaIds ?? [])) {
    const candidate = existing.media.find((media) => media.id === mediaId);
    const change = existing.changes.find((change) => change.id === candidate?.changeId);
    const replacement = input.proposal.changes.find(
      (next) =>
        next.entityType === change?.entityType &&
        next.entityId === change?.entityId &&
        next.operation === change?.operation,
    );
    const request = replacement?.media.find(
      (request) => request.path === candidate?.path && request.kind === candidate?.kind,
    );
    if (
      !candidate ||
      !change ||
      !request ||
      candidate.source === "CATALOG" ||
      request.catalogIds.length ||
      request.search ||
      request.generate
    ) {
      return {
        ok: false,
        status: 400,
        reason:
          "Retained media must belong to this proposal and use the same target, kind and path with no new search or generation",
      };
    }
    const key = mediaRequestKey(change, candidate.path);
    retained.set(key, [...(retained.get(key) ?? []), candidate]);
  }
  const proposal = {
    ...input.proposal,
    rationale: input.feedbackResponse
      ? `${input.proposal.rationale}\n\nResponse to staff feedback: ${input.feedbackResponse}`
      : input.proposal.rationale,
  };
  if (proposal.rationale.length > CONTENT_PROPOSAL_RATIONALE_LENGTH.max) {
    return {
      ok: false,
      status: 400,
      reason: "Rationale and feedback response are too long",
    };
  }
  const refs = [
    ...proposal.basis,
    ...proposal.changes.flatMap((change) =>
      change.entityId
        ? [{ entityType: change.entityType, entityId: change.entityId }]
        : [],
    ),
  ];
  const ids = [...new Set(refs.map((ref) => ref.entityId))];
  const drafts = proposal.changes.flatMap((change) => {
    if (change.operation !== "CREATE") return [];
    const name = draftName(
      Object.fromEntries(
        change.set.map((set) => [set.path, parsedJson(set.valueJson)]),
      ),
    );
    return name ? [{ entityType: change.entityType, name }] : [];
  });
  const [entities, open, rejected, names] = await Promise.all([
    loadEntities(client, refs),
    ids.length ? openTargets(client, ids, id) : Promise.resolve(new Set<string>()),
    ids.length
      ? rejectedChanges(client, ids, input.reactivate ? id : undefined)
      : Promise.resolve([]),
    drafts.length ? takenNames(client, drafts, id) : Promise.resolve(new Set<string>()),
  ]);
  const uploaded: string[] = [];
  let saved = false;
  try {
    const plan = await planAgentProposal(
      client,
      proposal,
      entities,
      {
        searches: CONTENT_AUDIT_MAX_SOUND_SEARCHES,
        generations: CONTENT_AUDIT_MAX_GENERATIONS,
      },
      { open, rejected, names, claimed: new Set() },
      uploaded,
      retained,
    );
    if (typeof plan === "string") return { ok: false, status: 422, reason: plan };
    // Searches and generations can take minutes. Recheck the full basis after media
    // preparation so a revision cannot deliberately revive an obsolete snapshot.
    const latest = await loadEntities(client, plan.basis);
    if (
      plan.basis.some(
        (basis) =>
          latest.get(entityKey(basis.entityType, basis.entityId))?.version !==
          basis.version,
      )
    ) {
      return {
        ok: false,
        status: 409,
        reason: "Content changed while revision media was prepared; fetch a new basis",
      };
    }
    const nextAt = new Date(
      Math.max(Date.now(), existing.statusChangedAt.getTime() + 1),
    );
    for (const row of [...plan.changes, ...plan.basis, ...plan.media])
      row.proposalId = id;
    saved = await client.transaction(async (tx) => {
      const claim = await tx
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
      if (claim.rowsAffected !== 1) return false;
      await tx
        .delete(contentProposalMedia)
        .where(eq(contentProposalMedia.proposalId, id));
      await tx
        .delete(contentProposalBasis)
        .where(eq(contentProposalBasis.proposalId, id));
      await tx
        .delete(contentProposalChange)
        .where(eq(contentProposalChange.proposalId, id));
      if (plan.changes.length)
        await tx.insert(contentProposalChange).values(plan.changes);
      if (plan.basis.length) await tx.insert(contentProposalBasis).values(plan.basis);
      if (plan.media.length) await tx.insert(contentProposalMedia).values(plan.media);
      return true;
    });
    if (!saved)
      return {
        ok: false,
        status: 409,
        reason: "Suggestion changed while the revision was prepared",
      };
    // A replacement may intentionally retain a previous image URL; do not delete its file.
    const retainedValues = JSON.stringify([plan.changes, plan.media]);
    await discardUploads(
      existing.media.flatMap((media) =>
        media.fileKey && !(media.url && retainedValues.includes(media.url))
          ? [media.fileKey]
          : [],
      ),
    );
    return { ok: true, id, statusChangedAt: nextAt.toISOString() };
  } finally {
    if (!saved) await discardUploads(uploaded);
  }
};

/**
 * A staff suggestion made from an editor form: `data` is the whole form, so only fields that
 * differ from the live row become the change. The basis is the target at its current version.
 * Returns the new suggestion's id, or the reason it was refused.
 */
export const createStaffProposal = async (
  client: DrizzleClient,
  userId: string,
  input: StaffCreateProposal,
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> => {
  const config = ENTITY_CONFIG[input.entityType];
  const entities = input.entityId
    ? await loadEntities(client, [
        { entityType: input.entityType, entityId: input.entityId },
      ])
    : new Map<string, ContentEntity>();
  const entity = input.entityId
    ? entities.get(entityKey(input.entityType, input.entityId))
    : undefined;
  if (input.entityId && !entity)
    return { ok: false, reason: `${config.label} not found` };
  const base = normalizeEditable(input.entityType, entity?.editable ?? {});
  // An empty select or input reads "" where the database holds null: a field the author left
  // empty is not part of the suggestion, so the live value stands and is what gets validated.
  const proposed = Object.fromEntries(
    Object.entries(editableOf(input.entityType, input.data)).filter(
      ([field, value]) => !(entity && value === "" && (base[field] ?? null) === null),
    ),
  );
  const parsed = config.validator.safeParse(
    entity ? { ...entity.payload, ...proposed } : proposed,
  );
  if (!parsed.success) {
    return {
      ok: false,
      reason: `The suggestion is invalid: ${firstIssue(parsed.error)}`,
    };
  }
  // Forms send "" where the database holds null and the validator stores one as the other,
  // so a field whose stored value would not change keeps its live value.
  const stored = (payload: unknown) =>
    normalizeEditable(
      input.entityType,
      editableOf(input.entityType, payload as Record<string, unknown>),
    );
  const liveParsed = entity ? config.validator.safeParse(entity.payload) : undefined;
  const live = liveParsed?.success ? stored(liveParsed.data) : undefined;
  const next = Object.fromEntries(
    Object.entries(stored(parsed.data)).map(([field, value]) => [
      field,
      live && sameValue(live[field], value) ? base[field] : value,
    ]),
  );
  const diff = changedFields(base, next);
  if (Object.keys(diff.after).length === 0) {
    return { ok: false, reason: "Nothing changed compared to the live version" };
  }
  const proposalId = nanoid();
  await insertRows(client, [
    {
      proposal: {
        id: proposalId,
        title: input.title,
        rationale: input.rationale,
        category: input.category,
        source: "STAFF",
        createdByUserId: userId,
      },
      changes: [
        {
          id: nanoid(),
          proposalId,
          entityType: input.entityType,
          entityId: entity?.id ?? null,
          operation: entity ? "UPDATE" : "CREATE",
          before: diff.before,
          after: diff.after,
        },
      ],
      basis: entity
        ? [
            {
              proposalId,
              entityType: input.entityType,
              entityId: entity.id,
              version: entity.version,
              role: "TARGET",
            },
          ]
        : [],
      media: [],
    },
  ]);
  return { ok: true, id: proposalId };
};

/**
 * Editable fields with their order-insensitive lists (item recipes, AI jutsus and drops)
 * sorted the way the entity loader sorts them, so reordering a list is not a change.
 */
export const normalizeEditable = (
  entityType: ContentProposalEntityType,
  editable: Record<string, unknown>,
) => {
  const byFirstId = (list: unknown) =>
    Array.isArray(list)
      ? [...(list as { ids?: string[] }[])].sort((a, b) =>
          (a.ids?.[0] ?? "").localeCompare(b.ids?.[0] ?? ""),
        )
      : list;
  if (entityType === "ITEM" && "craftingRequirements" in editable) {
    return {
      ...editable,
      craftingRequirements: byFirstId(editable.craftingRequirements),
    };
  }
  if (entityType === "AI") {
    return {
      ...editable,
      ...("jutsus" in editable && Array.isArray(editable.jutsus)
        ? { jutsus: [...(editable.jutsus as string[])].sort() }
        : {}),
      ...("items" in editable ? { items: byFirstId(editable.items) } : {}),
    };
  }
  return editable;
};

/** First issue that makes `payload` invalid, as "path: message"; null when it is valid. */
export const validationError = (validator: z.ZodType, payload: unknown) => {
  const parsed = validator.safeParse(payload);
  return parsed.success ? null : firstIssue(parsed.error);
};

/**
 * Rows for one audit suggestion, or the reason it is refused. Its changes are replayed on
 * the live editable fields and its media requests collect candidates, whose file keys go to
 * `uploaded` so a refusal can delete them. An accepted suggestion adds its targets and the
 * names it drafts to `guards`.
 */
const planAgentProposal = async (
  client: DrizzleClient,
  proposal: AgentProposal,
  entities: Map<string, ContentEntity>,
  budget: MediaBudget,
  guards: Guards,
  uploaded: string[],
  retained?: Map<string, (typeof contentProposalMedia.$inferSelect)[]>,
): Promise<Rows | string> => {
  const proposalId = nanoid();
  const rows: Rows = {
    proposal: {
      id: proposalId,
      title: proposal.title,
      rationale: proposal.rationale,
      category: proposal.category,
      source: "AGENT",
      confidence: proposal.confidence,
      expiresAt: proposal.usesUsageData
        ? secondsFromNow(CONTENT_PROPOSAL_EVIDENCE_DAYS * DAY_S)
        : null,
    },
    changes: [],
    basis: [],
    media: [],
  };
  const targets = new Set<string>();
  const drafted = new Set<string>();
  for (const [order, change] of proposal.changes.entries()) {
    const config = ENTITY_CONFIG[change.entityType];
    const changeId = nanoid();
    let entity: ContentEntity | undefined;
    if (change.operation === "UPDATE") {
      if (!change.entityId) return `${config.label} update is missing its id`;
      entity = entities.get(entityKey(change.entityType, change.entityId));
      if (!entity) return `${config.label} ${change.entityId} does not exist`;
      const key = entityKey(change.entityType, change.entityId);
      if (guards.claimed.has(key) || guards.open.has(key)) {
        return `An open suggestion already targets ${config.label} ${entity.name}`;
      }
      targets.add(key);
    } else if (change.entityId) {
      return "A new entity cannot carry an id";
    } else if (change.entityType === "GAME_ASSET") {
      // A draft has no way to bring a file; new sounds and images arrive as media candidates
      // and become assets when their suggestion is approved.
      return "New assets come from media candidates, not drafts";
    }
    const operations: SetOperation[] = [];
    for (const set of change.set) {
      try {
        operations.push({
          path: set.path,
          value: JSON.parse(set.valueJson) as unknown,
        });
      } catch {
        return `${set.path}: valueJson is not valid JSON`;
      }
    }
    const base = entity?.editable ?? {};
    const applied = applySetOperations(change.entityType, base, operations);
    if (!applied.ok) return applied.reason;
    let next = applied.editable;
    for (const request of change.media) {
      if (
        !config.editableKeys.includes(topLevelField(request.path)) ||
        !isMediaPath(request.kind, request.path)
      ) {
        return `${request.path} cannot hold ${request.kind.toLowerCase()} media`;
      }
      const kept = retained?.get(mediaRequestKey(change, request.path));
      const candidates =
        kept ?? (await collectCandidates(client, request, budget, config.contentType));
      if (!kept)
        uploaded.push(...candidates.flatMap((candidate) => candidate.fileKey ?? []));
      if (candidates.length === 0) {
        return `No ${request.kind.toLowerCase()} candidates were found for ${request.path}`;
      }
      const media = candidates.map((candidate, sortOrder) => ({
        ...candidate,
        id: nanoid(),
        proposalId,
        changeId,
        path: request.path,
        sortOrder,
        chosen: false,
      }));
      rows.media.push(...media);
      // The field shows the first candidate: its final value, or `media:<candidate id>` for a
      // sound that only becomes an asset when the suggestion is approved.
      const preview = media[0] as MediaInsert;
      const value =
        preview.source === "CATALOG" ||
        (preview.kind === "IMAGE" && !isSceneCharacterPath(request.path))
          ? materializeChoice(
              {
                ...preview,
                path: request.path,
                externalId: preview.externalId ?? null,
                url: preview.url ?? null,
              },
              "",
            ).value
          : `media:${preview.id}`;
      const withMedia = applySetOperations(change.entityType, next, [
        { path: request.path, value },
      ]);
      if (!withMedia.ok) return withMedia.reason;
      next = withMedia.editable;
    }
    const violation = agentChangeViolation(base, next);
    if (violation) return violation;
    if (change.operation === "CREATE") {
      // A draft without a name is left to the validator below, which says so.
      const name = draftName(next);
      const key = nameKey(change.entityType, name);
      if (name && (guards.names.has(key) || drafted.has(key))) {
        return `${config.label} ${name} already exists or is waiting in the queue`;
      }
      if (name) drafted.add(key);
    }
    const diff = changedFields(base, next);
    if (Object.keys(diff.after).length === 0)
      return `${config.label} change has no effect`;
    const invalid = validationError(
      config.validator,
      entity ? { ...entity.payload, ...next } : next,
    );
    if (invalid) return `${config.label} would be invalid: ${invalid}`;
    if (
      entity &&
      guards.rejected.some(
        (row) =>
          row.entityType === change.entityType &&
          row.entityId === entity.id &&
          sameValue(row.after, diff.after),
      )
    ) {
      return `The same change to ${config.label} ${entity.name} was rejected recently`;
    }
    rows.changes.push({
      id: changeId,
      proposalId,
      entityType: change.entityType,
      entityId: entity?.id ?? null,
      operation: change.operation,
      before: diff.before,
      after: diff.after,
      sortOrder: order,
    });
  }
  for (const basis of proposal.basis) {
    const key = entityKey(basis.entityType, basis.entityId);
    const entity = entities.get(key);
    const label = ENTITY_CONFIG[basis.entityType].label;
    if (!entity) return `Basis ${label} ${basis.entityId} does not exist`;
    if (entity.version !== basis.v) {
      return `${label} ${entity.name} changed after the snapshot was taken`;
    }
    if (rows.basis.some((row) => entityKey(row.entityType, row.entityId) === key))
      continue;
    rows.basis.push({
      proposalId,
      entityType: basis.entityType,
      entityId: basis.entityId,
      version: entity.version,
      role: targets.has(key) ? "TARGET" : "CONTEXT",
    });
  }
  const listed = new Set(
    rows.basis.map((row) => entityKey(row.entityType, row.entityId)),
  );
  if ([...targets].some((key) => !listed.has(key))) {
    return "Every changed entity must be listed in basis with the version it was read at";
  }
  // Claimed only once nothing can refuse the suggestion any more.
  for (const key of targets) guards.claimed.add(key);
  for (const key of drafted) guards.names.add(key);
  return rows;
};

/** Markdown table of the outcome for the audit job's summary, one row per suggestion. */
const submissionSummary = (submission: AgentSubmission, result: SubmissionResult) => {
  const lines = [
    `### Content audit${submission.focus ? ` · focus: ${submission.focus}` : ""}`,
    "",
    `Accepted ${result.accepted.length} of ${submission.proposals.length}.`,
    "",
    "| # | Suggestion | Result |",
    "|---|---|---|",
    ...submission.proposals.map((proposal, index) => {
      const refused = result.refused.find((entry) => entry.index === index);
      return `| ${index + 1} | ${proposal.title.replaceAll("|", "/")} | ${
        refused ? `refused: ${refused.reason.replaceAll("|", "/")}` : "accepted"
      } |`;
    }),
  ];
  return lines.join("\n");
};

/** Targets that already have a pending suggestion, as `entityKey`s. */
const openTargets = async (
  client: DrizzleClient,
  ids: string[],
  excludeId?: string,
) => {
  const rows = await client
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
  return new Set(
    rows.flatMap((row) =>
      row.entityId ? [entityKey(row.entityType, row.entityId)] : [],
    ),
  );
};

/** Rejected changes still within retention, so the audit cannot resubmit them unchanged. */
const rejectedChanges = async (
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

/**
 * Which drafted names new content cannot take, as `nameKey`s: names a live entity of the type
 * already has, and names of new entities still waiting in the queue.
 */
const takenNames = async (
  client: DrizzleClient,
  drafts: { entityType: ContentProposalEntityType; name: string }[],
  excludeId?: string,
) => {
  const types = [...new Set(drafts.map((draft) => draft.entityType))];
  const [live, queued] = await Promise.all([
    Promise.all(
      types.map(async (type) => {
        const names = drafts
          .filter((draft) => draft.entityType === type)
          .map((draft) => draft.name);
        const found = await ENTITY_CONFIG[type].findNames(client, names);
        return found.map((name) => nameKey(type, name));
      }),
    ),
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
      ),
  ]);
  return new Set([
    ...live.flat(),
    ...queued.map((row) => nameKey(row.entityType, draftName(row.after))),
  ]);
};

/** A name within its content type; names compare without case or surrounding spaces. */
const nameKey = (type: ContentProposalEntityType, name: string) =>
  `${type}:${name.trim().toLowerCase()}`;

const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * A suggestion's rows span four tables and are only useful together, and a failed save
 * deletes the candidate files they point at, so they are written in one short transaction.
 */
const insertRows = async (client: DrizzleClient, rows: Rows[]) => {
  if (rows.length === 0) return;
  const changes = rows.flatMap((row) => row.changes);
  const basis = rows.flatMap((row) => row.basis);
  const media = rows.flatMap((row) => row.media);
  await client.transaction(async (tx) => {
    await tx.insert(contentProposal).values(rows.map((row) => row.proposal));
    if (changes.length) await tx.insert(contentProposalChange).values(changes);
    if (basis.length) await tx.insert(contentProposalBasis).values(basis);
    if (media.length) await tx.insert(contentProposalMedia).values(media);
  });
};

const mediaKeys = (planned: Rows[]) =>
  planned.flatMap((rows) => rows.media.flatMap((row) => row.fileKey ?? []));

/**
 * Delete the candidate files of suggestions that are not saved. Best effort: a failure is
 * only logged and the files stay behind, since the hourly cleanup only finds files that a
 * saved suggestion records.
 */
const discardUploads = async (keys: string[]) => {
  if (keys.length === 0) return;
  await deleteStoredFiles(keys).catch((error: unknown) => {
    console.error("Could not delete candidate files of a dropped suggestion", error);
  });
};

const firstIssue = (error: z.ZodError) => {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "value"}: ${issue.message}` : "invalid";
};

/** Outcome of an audit submission: suggestions by their index, and a markdown summary. */
type SubmissionResult = {
  accepted: { index: number; id: string; title: string }[];
  refused: { index: number; title: string; reason: string }[];
  summary: string;
};

/** What refuses an audit suggestion beyond its own content. */
type Guards = {
  /** Targets with a pending suggestion. */
  open: Set<string>;
  /** Recently rejected changes to the targets. */
  rejected: Awaited<ReturnType<typeof rejectedChanges>>;
  /** Targets of suggestions accepted earlier in the same submission. */
  claimed: Set<string>;
  /** Names new content cannot take, from `takenNames` and the drafts accepted so far. */
  names: Set<string>;
};

/** The rows one suggestion writes, across its four tables. */
type Rows = {
  proposal: ProposalInsert;
  changes: ChangeInsert[];
  basis: BasisInsert[];
  media: MediaInsert[];
};

type ProposalInsert = typeof contentProposal.$inferInsert;
type ChangeInsert = typeof contentProposalChange.$inferInsert;
type BasisInsert = typeof contentProposalBasis.$inferInsert;
type MediaInsert = typeof contentProposalMedia.$inferInsert;

/** A candidate is tied to its original target and field when refining the same draft. */
const mediaRequestKey = (
  change: { entityType: string; entityId: string | null; operation: string },
  path: string,
) => JSON.stringify([change.entityType, change.entityId, change.operation, path]);
