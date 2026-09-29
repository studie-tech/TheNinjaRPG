import { and, eq, inArray, lt } from "drizzle-orm";
import {
  CONTENT_PROPOSAL_EVIDENCE_DAYS,
  type ContentProposalEntityType,
} from "@/drizzle/constants";
import { contentProposal, contentProposalBasis } from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { entityKey, entityLabel, loadEntities } from "./entities";
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
  const rows = await client
    .select({
      id: contentProposalBasis.proposalId,
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
  await markOutdated(client, [...new Set(changed.map((row) => row.id))], reason);
};

/** Reason shown for an edit made through one of the content editors. */
export const editedReason = (
  entityType: ContentProposalEntityType,
  name: string,
  username: string,
) => `${entityLabel(entityType)} ${name} was edited by ${username}`;

export const deletedReason = (
  entityType: ContentProposalEntityType,
  name: string,
  username: string,
) => `${entityLabel(entityType)} ${name} was deleted by ${username}`;

const markOutdated = async (client: DrizzleClient, ids: string[], reason: string) => {
  if (ids.length === 0) return;
  await client
    .update(contentProposal)
    .set({
      status: "OUTDATED",
      outdatedReason: reason.slice(0, 191),
      statusChangedAt: new Date(),
    })
    .where(
      and(inArray(contentProposal.id, ids), eq(contentProposal.status, "PENDING")),
    );
};

/**
 * Re-check the basis of the given pending suggestions against the live rows, and expire
 * suggestions whose usage data is too old. This catches edits that bypassed the content
 * editors (migrations, console fixes). Returns the reason per suggestion that went out of
 * date.
 */
export const refreshProposalFreshness = async (
  client: DrizzleClient,
  proposals: {
    id: string;
    expiresAt: Date | null;
    basis: {
      entityType: ContentProposalEntityType;
      entityId: string;
      version: string;
    }[];
  }[],
) => {
  const outdated = new Map<string, string>();
  if (proposals.length === 0) return outdated;
  const entities = await loadEntities(
    client,
    proposals.flatMap((proposal) => proposal.basis),
  );
  const now = Date.now();
  const byReason = new Map<string, string[]>();
  const add = (reason: string, id: string) => {
    byReason.set(reason, [...(byReason.get(reason) ?? []), id]);
    outdated.set(id, reason);
  };
  for (const proposal of proposals) {
    if (proposal.expiresAt && proposal.expiresAt.getTime() < now) {
      add(
        `Its usage data is older than ${CONTENT_PROPOSAL_EVIDENCE_DAYS} days`,
        proposal.id,
      );
      continue;
    }
    for (const basis of proposal.basis) {
      const entity = entities.get(entityKey(basis.entityType, basis.entityId));
      const version = entity?.version ?? MISSING_VERSION;
      if (version === basis.version) continue;
      const label = entityLabel(basis.entityType);
      add(
        entity
          ? `${label} ${entity.name} changed since the suggestion was made`
          : `${label} ${basis.entityId} no longer exists`,
        proposal.id,
      );
      break;
    }
  }
  await Promise.all(
    [...byReason.entries()].map(([reason, ids]) => markOutdated(client, ids, reason)),
  );
  return outdated;
};

/** Pending suggestions whose usage data has expired, for the nightly sweep. */
export const expireStaleEvidence = async (client: DrizzleClient) => {
  const rows = await client
    .select({ id: contentProposal.id })
    .from(contentProposal)
    .where(
      and(
        eq(contentProposal.status, "PENDING"),
        lt(contentProposal.expiresAt, new Date()),
      ),
    );
  await markOutdated(
    client,
    rows.map((row) => row.id),
    `Its usage data is older than ${CONTENT_PROPOSAL_EVIDENCE_DAYS} days`,
  );
};
