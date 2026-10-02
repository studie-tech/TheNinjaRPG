import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { CONTENT_PROPOSAL_RETENTION_DAYS } from "@/drizzle/constants";
import {
  contentProposal,
  contentProposalBasis,
  contentProposalChange,
  contentProposalMedia,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { DAY_S, secondsFromNow } from "@/utils/time";
import { deleteStoredFiles } from "./media";
import { expireStaleEvidence } from "./outdate";

/**
 * Hourly housekeeping from the cleaner cron: expire suggestions whose usage data is too old,
 * remove rejected and outdated suggestions once the retention window has passed, and delete
 * uploaded candidates nobody picked. Applied and reverted suggestions stay as history.
 * Returns how many suggestions were removed and how many candidate files were deleted.
 */
export const cleanupContentProposals = async (client: DrizzleClient) => {
  await expireStaleEvidence(client);
  const cutoff = secondsFromNow(-CONTENT_PROPOSAL_RETENTION_DAYS * DAY_S);
  const [expired, leftovers] = await Promise.all([
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
      .limit(BATCH),
    client
      .select({ id: contentProposalMedia.id, fileKey: contentProposalMedia.fileKey })
      .from(contentProposalMedia)
      .innerJoin(
        contentProposal,
        eq(contentProposal.id, contentProposalMedia.proposalId),
      )
      .where(
        and(
          inArray(contentProposal.status, ["APPLIED", "REVERTED"]),
          eq(contentProposalMedia.chosen, false),
          // An approval claims APPLIED before saving its selected media. Give the bounded
          // request time to finish so cleanup cannot delete its still-unchosen candidate.
          lt(contentProposal.statusChangedAt, secondsFromNow(-LEFTOVER_GRACE_S)),
          isNotNull(contentProposalMedia.fileKey),
        ),
      )
      .limit(BATCH),
  ]);
  let removed = 0;
  let filesDeleted = 0;
  for (const candidate of expired) {
    // Retention deletion destroys files outside MySQL. Lock the existing parent while
    // checking its revision and deleting files, so reactivation either wins first or waits
    // and finds the proposal gone. A file failure rolls back and leaves a retryable row.
    // One proposal per transaction keeps unrelated review work free of these storage calls.
    const result = await client.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: contentProposal.id })
        .from(contentProposal)
        .where(
          and(
            eq(contentProposal.id, candidate.id),
            eq(contentProposal.status, candidate.status),
            eq(contentProposal.statusChangedAt, candidate.statusChangedAt),
            inArray(contentProposal.status, ["REJECTED", "OUTDATED"]),
            lt(contentProposal.statusChangedAt, cutoff),
          ),
        )
        .for("update");
      if (!current) return null;
      const candidates = await tx
        .select({ fileKey: contentProposalMedia.fileKey })
        .from(contentProposalMedia)
        .where(
          and(
            eq(contentProposalMedia.proposalId, candidate.id),
            isNotNull(contentProposalMedia.fileKey),
          ),
        );
      const keys = candidates.flatMap((row) => (row.fileKey ? [row.fileKey] : []));
      await deleteStoredFiles(keys);
      await tx
        .delete(contentProposalMedia)
        .where(eq(contentProposalMedia.proposalId, candidate.id));
      await tx
        .delete(contentProposalBasis)
        .where(eq(contentProposalBasis.proposalId, candidate.id));
      await tx
        .delete(contentProposalChange)
        .where(eq(contentProposalChange.proposalId, candidate.id));
      await tx.delete(contentProposal).where(eq(contentProposal.id, candidate.id));
      return keys.length;
    });
    if (result !== null) {
      removed++;
      filesDeleted += result;
    }
  }
  // Applied/reverted suggestions cannot be refined. Files first retains retryable rows
  // if storage fails; their chosen candidates remain excluded from cleanup.
  await deleteStoredFiles(
    leftovers.flatMap((row) => (row.fileKey ? [row.fileKey] : [])),
  );
  if (leftovers.length) {
    await client.delete(contentProposalMedia).where(
      inArray(
        contentProposalMedia.id,
        leftovers.map((row) => row.id),
      ),
    );
  }
  return { removed, filesDeleted: filesDeleted + leftovers.length };
};

/** Suggestions and leftover files handled per run; a bigger backlog clears over later runs. */
const BATCH = 500;

/** Approval routes can run for five minutes while saving content and media selections. */
const LEFTOVER_GRACE_S = 5 * 60;
