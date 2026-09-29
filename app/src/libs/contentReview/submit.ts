import { and, count, eq, gte, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { z } from "zod";
import {
  CONTENT_AUDIT_BACKLOG_LIMIT,
  CONTENT_AUDIT_DAILY_LIMIT,
  CONTENT_AUDIT_MAX_GENERATIONS,
  CONTENT_AUDIT_MAX_SOUND_SEARCHES,
  CONTENT_PROPOSAL_EVIDENCE_DAYS,
  type ContentProposalEntityType,
} from "@/drizzle/constants";
import {
  contentProposal,
  contentProposalBasis,
  contentProposalChange,
  contentProposalMedia,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import type {
  AgentProposal,
  AgentSubmission,
  StaffCreateProposal,
} from "@/validators/contentReview";
import {
  type ContentEntity,
  ENTITY_CONFIG,
  editableOf,
  entityKey,
  loadEntities,
} from "./entities";
import { collectCandidates, type MediaBudget, materializeChoice } from "./media";
import {
  agentChangeViolation,
  applySetOperations,
  changedFields,
  isMediaPath,
  withCreateBaseline,
} from "./rules";
import { sameValue } from "./version";

type ProposalInsert = typeof contentProposal.$inferInsert;
type ChangeInsert = typeof contentProposalChange.$inferInsert;
type BasisInsert = typeof contentProposalBasis.$inferInsert;
type MediaInsert = typeof contentProposalMedia.$inferInsert;

type Rows = {
  proposal: ProposalInsert;
  changes: ChangeInsert[];
  basis: BasisInsert[];
  media: MediaInsert[];
};

export type SubmissionResult = {
  accepted: { index: number; id: string; title: string }[];
  refused: { index: number; title: string; reason: string }[];
  summary: string;
};

/** How many more suggestions the audit may add right now. */
export const auditQuota = async (client: DrizzleClient) => {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const [[today], [waiting]] = await Promise.all([
    client
      .select({ n: count() })
      .from(contentProposal)
      .where(
        and(
          eq(contentProposal.source, "AGENT"),
          gte(contentProposal.createdAt, startOfDay),
        ),
      ),
    client
      .select({ n: count() })
      .from(contentProposal)
      .where(
        and(eq(contentProposal.source, "AGENT"), eq(contentProposal.status, "PENDING")),
      ),
  ]);
  const addedToday = today?.n ?? 0;
  const waitingNow = waiting?.n ?? 0;
  return {
    addedToday,
    dailyLimit: CONTENT_AUDIT_DAILY_LIMIT,
    waiting: waitingNow,
    backlogLimit: CONTENT_AUDIT_BACKLOG_LIMIT,
    remaining: Math.max(
      0,
      Math.min(
        CONTENT_AUDIT_DAILY_LIMIT - addedToday,
        CONTENT_AUDIT_BACKLOG_LIMIT - waitingNow,
      ),
    ),
  };
};

/**
 * Validate and store the audit's suggestions. Every change is replayed against the live row:
 * `before` comes from the database, never from the model, and a basis version that no longer
 * matches means the snapshot was already stale, so the suggestion is refused.
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
  const [quota, entities, open, rejected] = await Promise.all([
    auditQuota(client),
    loadEntities(client, refs),
    targetIds.length ? openTargets(client, targetIds) : Promise.resolve(new Map()),
    targetIds.length ? rejectedChanges(client, targetIds) : Promise.resolve([]),
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
    if (planned.length >= quota.remaining) {
      refuse(
        quota.remaining === 0
          ? `The audit limit is reached (${quota.addedToday}/${quota.dailyLimit} today, ${quota.waiting}/${quota.backlogLimit} waiting)`
          : "The daily limit was reached by earlier suggestions in this run",
      );
      continue;
    }
    const plan = await planAgentProposal(client, proposal, entities, budget, {
      open,
      rejected,
      claimed,
    });
    if (typeof plan === "string") {
      refuse(plan);
      continue;
    }
    plan.proposal.agentName = submission.agentName;
    plan.proposal.runUrl = submission.runUrl ?? null;
    plan.proposal.focus = submission.focus ?? null;
    planned.push(plan);
    result.accepted.push({ index, id: plan.proposal.id, title: proposal.title });
  }
  await insertRows(client, planned);
  result.summary = submissionSummary(submission, result, quota, planned.length);
  return result;
};

type Guards = {
  open: Map<string, string>;
  rejected: Awaited<ReturnType<typeof rejectedChanges>>;
  claimed: Set<string>;
};

const planAgentProposal = async (
  client: DrizzleClient,
  proposal: AgentProposal,
  entities: Map<string, ContentEntity>,
  budget: MediaBudget,
  guards: Guards,
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
        ? new Date(Date.now() + CONTENT_PROPOSAL_EVIDENCE_DAYS * 86_400_000)
        : null,
    },
    changes: [],
    basis: [],
    media: [],
  };
  const targets = new Set<string>();
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
    }
    const operations: { path: string; value: unknown }[] = [];
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
      const field = request.path.split(".")[0] ?? "";
      if (
        !config.editableKeys.includes(field) ||
        !isMediaPath(request.kind, request.path)
      ) {
        return `${request.path} cannot hold ${request.kind.toLowerCase()} media`;
      }
      const candidates = await collectCandidates(
        client,
        request,
        budget,
        config.contentType,
      );
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
      }));
      rows.media.push(...media);
      const preview = media[0] as MediaInsert;
      const value =
        preview.source === "CATALOG" || preview.kind === "IMAGE"
          ? materializeChoice(
              {
                ...preview,
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
    if (change.operation === "CREATE") {
      const drafted = withCreateBaseline(change.entityType, next);
      if (!drafted.ok) return drafted.reason;
      next = drafted.editable;
    } else {
      const violation = agentChangeViolation(change.entityType, base, next);
      if (violation) return violation;
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
  for (const key of targets) {
    if (!rows.basis.some((row) => entityKey(row.entityType, row.entityId) === key)) {
      return "Every changed entity must be listed in basis with the version it was read at";
    }
    guards.claimed.add(key);
  }
  return rows;
};

/**
 * A staff suggestion made from an editor form: `data` is the whole form, so only fields that
 * differ from the live row become the change. The basis is the target at its current version.
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
  const proposed = editableOf(input.entityType, input.data);
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

/** Order-insensitive lists are sorted the same way the entity loader sorts them. */
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

export const validationError = (validator: z.ZodType, payload: unknown) => {
  const parsed = validator.safeParse(payload);
  return parsed.success ? null : firstIssue(parsed.error);
};

const firstIssue = (error: z.ZodError) => {
  const issue = error.issues[0];
  return issue ? `${issue.path.join(".") || "value"}: ${issue.message}` : "invalid";
};

const insertRows = async (client: DrizzleClient, rows: Rows[]) => {
  if (rows.length === 0) return;
  const changes = rows.flatMap((row) => row.changes);
  const basis = rows.flatMap((row) => row.basis);
  const media = rows.flatMap((row) => row.media);
  await Promise.all([
    client.insert(contentProposal).values(rows.map((row) => row.proposal)),
    changes.length ? client.insert(contentProposalChange).values(changes) : null,
    basis.length ? client.insert(contentProposalBasis).values(basis) : null,
    media.length ? client.insert(contentProposalMedia).values(media) : null,
  ]);
};

/** Targets that already have a pending suggestion, keyed by `${type}:${id}`. */
const openTargets = async (client: DrizzleClient, ids: string[]) => {
  const rows = await client
    .select({
      entityType: contentProposalChange.entityType,
      entityId: contentProposalChange.entityId,
      title: contentProposal.title,
    })
    .from(contentProposalChange)
    .innerJoin(
      contentProposal,
      eq(contentProposal.id, contentProposalChange.proposalId),
    )
    .where(
      and(
        eq(contentProposal.status, "PENDING"),
        inArray(contentProposalChange.entityId, ids),
      ),
    );
  return new Map(
    rows.flatMap((row) =>
      row.entityId
        ? [[entityKey(row.entityType, row.entityId), row.title] as const]
        : [],
    ),
  );
};

/** Rejected changes still within retention, so the audit cannot resubmit them unchanged. */
const rejectedChanges = async (client: DrizzleClient, ids: string[]) =>
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
        inArray(contentProposalChange.entityId, ids),
      ),
    );

const submissionSummary = (
  submission: AgentSubmission,
  result: SubmissionResult,
  quota: Awaited<ReturnType<typeof auditQuota>>,
  added: number,
) => {
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
    "",
    `Audit suggestions today: ${quota.addedToday + added}/${quota.dailyLimit}. Waiting for review: ${quota.waiting + added}/${quota.backlogLimit}.`,
  ];
  return lines.join("\n");
};
