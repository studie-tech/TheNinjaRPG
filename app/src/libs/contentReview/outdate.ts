import {
  CONTENT_PROPOSAL_EVIDENCE_DAYS,
  type ContentProposalEntityType,
} from "@/drizzle/constants";
import {
  selectContentProposalBasisForOutdateProposalsFor,
  selectContentProposalForExpireStaleEvidence,
  selectContentProposalForReinstateProposalsFor,
  updateContentProposalForMarkOutdated,
  updateContentProposalForReinstateProposalsFor,
} from "@/queries/contentReview";
import type { DrizzleClient } from "@/server/db";
import { type ContentEntity, entityKey, loadEntities } from "./entities";
import { ENTITY_LABELS } from "./labels";
import { MISSING_VERSION } from "./version";

/**
 * Mark pending suggestions that rest on these entities as outdated. Every content update and
 * delete calls this once its write has finished, so a suggestion built on an old version
 * leaves the queue the moment its basis changes, while a save that changed nothing leaves it
 * in place. Only PENDING rows are touched, which leaves out the suggestion being applied.
 */
export const outdateProposalsFor = async (
  client: DrizzleClient,
  entityType: ContentProposalEntityType,
  entityIds: string[],
  reason: string,
) => {
  if (entityIds.length === 0) return;
  const rows = await selectContentProposalBasisForOutdateProposalsFor(
    client,
    entityType,
    entityIds,
  );
  if (rows.length === 0) return;
  const live = await loadEntities(
    client,
    entityIds.map((entityId) => ({ entityType, entityId })),
  );
  const changed = rows.filter(
    (row) =>
      (live.get(entityKey(entityType, row.entityId))?.version ?? MISSING_VERSION) !==
      row.version,
  );
  await markOutdated(client, changed, reason);
};

/** Reason shown for an edit made through one of the content editors. */
export const editedReason = (
  entityType: ContentProposalEntityType,
  name: string,
  username: string,
) => `${ENTITY_LABELS[entityType]} ${name} was edited by ${username}`;

/** Reason shown for a deletion made through one of the content editors. */
export const deletedReason = (
  entityType: ContentProposalEntityType,
  name: string,
  username: string,
) => `${ENTITY_LABELS[entityType]} ${name} was deleted by ${username}`;

/**
 * Return to the queue the suggestions an undone approval outdated. Once its writes are rolled
 * back, a suggestion outdated since `since` that rests on one of these entities is current
 * again when its whole basis matches the live rows and its usage data has not expired.
 */
export const reinstateProposalsFor = async (
  client: DrizzleClient,
  refs: { entityType: ContentProposalEntityType; entityId: string }[],
  since: Date,
) => {
  if (refs.length === 0) return;
  const rows = await selectContentProposalForReinstateProposalsFor(client, since);
  const touched = new Set(refs.map((ref) => entityKey(ref.entityType, ref.entityId)));
  const byProposal = new Map<string, typeof rows>();
  for (const row of rows)
    byProposal.set(row.id, [...(byProposal.get(row.id) ?? []), row]);
  const candidates = [...byProposal.values()].filter(
    (basis) =>
      basis.some((row) => touched.has(entityKey(row.entityType, row.entityId))) &&
      !basis.some((row) => row.expiresAt && row.expiresAt.getTime() < Date.now()),
  );
  if (candidates.length === 0) return;
  const live = await loadEntities(client, candidates.flat());
  const current = candidates.filter((basis) =>
    basis.every(
      (row) =>
        (live.get(entityKey(row.entityType, row.entityId))?.version ??
          MISSING_VERSION) === row.version,
    ),
  );
  if (current.length === 0) return;
  await updateContentProposalForReinstateProposalsFor(client, current);
};

/**
 * Re-check the basis of the given pending suggestions against the live rows, and expire
 * suggestions whose usage data is too old. This catches edits that bypassed the content
 * editors (migrations, console fixes). Pass `loaded` when the caller already holds the basis
 * entities, keyed by `entityKey`, to save loading them again. Returns the reason per
 * suggestion that went out of date.
 */
export const refreshProposalFreshness = async (
  client: DrizzleClient,
  proposals: {
    id: string;
    statusChangedAt: Date;
    expiresAt: Date | null;
    basis: {
      entityType: ContentProposalEntityType;
      entityId: string;
      version: string;
    }[];
  }[],
  loaded?: Map<string, ContentEntity>,
) => {
  const outdated = new Map<string, string>();
  if (proposals.length === 0) return outdated;
  const entities =
    loaded ??
    (await loadEntities(
      client,
      proposals.flatMap((proposal) => proposal.basis),
    ));
  const now = Date.now();
  const byReason = new Map<string, typeof proposals>();
  const add = (reason: string, proposal: (typeof proposals)[number]) => {
    byReason.set(reason, [...(byReason.get(reason) ?? []), proposal]);
    outdated.set(proposal.id, reason);
  };
  for (const proposal of proposals) {
    if (proposal.expiresAt && proposal.expiresAt.getTime() < now) {
      add(EXPIRED_EVIDENCE_REASON, proposal);
      continue;
    }
    for (const basis of proposal.basis) {
      const entity = entities.get(entityKey(basis.entityType, basis.entityId));
      const version = entity?.version ?? MISSING_VERSION;
      if (version === basis.version) continue;
      const label = ENTITY_LABELS[basis.entityType];
      add(
        entity
          ? `${label} ${entity.name} changed since the suggestion was made`
          : `${label} ${basis.entityId} no longer exists`,
        proposal,
      );
      break;
    }
  }
  await Promise.all(
    [...byReason.entries()].map(([reason, revisions]) =>
      markOutdated(client, revisions, reason),
    ),
  );
  return outdated;
};

/** Outdate pending suggestions whose usage data has expired. */
export const expireStaleEvidence = async (client: DrizzleClient) => {
  const rows = await selectContentProposalForExpireStaleEvidence(client);
  await markOutdated(client, rows, EXPIRED_EVIDENCE_REASON);
};

const EXPIRED_EVIDENCE_REASON = `Its usage data is older than ${CONTENT_PROPOSAL_EVIDENCE_DAYS} days`;

/** Outdate those of `revisions` that are still pending, with `reason` cut to fit its column. */
const markOutdated = async (
  client: DrizzleClient,
  revisions: { id: string; statusChangedAt: Date }[],
  reason: string,
) => {
  if (revisions.length === 0) return;
  await updateContentProposalForMarkOutdated(client, reason, revisions);
};
