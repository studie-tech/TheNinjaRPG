import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { CONTENT_PROPOSAL_RETENTION_DAYS } from "@/drizzle/constants";
import {
  contentProposal,
  contentProposalBasis,
  contentProposalChange,
  contentProposalMedia,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { deleteStoredFiles } from "./media";
import { expireStaleEvidence } from "./outdate";

const BATCH = 500;

/**
 * Hourly housekeeping from the cleaner cron: expire suggestions whose usage data is too old,
 * remove rejected and outdated suggestions once the retention window has passed, and delete
 * uploaded candidates nobody picked. Applied and reverted suggestions stay as history.
 */
export const cleanupContentProposals = async (client: DrizzleClient) => {
  await expireStaleEvidence(client);
  const cutoff = new Date(Date.now() - CONTENT_PROPOSAL_RETENTION_DAYS * 86_400_000);
  const [expired, leftovers] = await Promise.all([
    client
      .select({ id: contentProposal.id })
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
          isNotNull(contentProposalMedia.fileKey),
        ),
      )
      .limit(BATCH),
  ]);
  const ids = expired.map((row) => row.id);
  const expiredMedia = ids.length
    ? await client
        .select({ fileKey: contentProposalMedia.fileKey })
        .from(contentProposalMedia)
        .where(
          and(
            inArray(contentProposalMedia.proposalId, ids),
            isNotNull(contentProposalMedia.fileKey),
          ),
        )
    : [];
  // Files first: a failed storage call keeps the rows, so the next run retries it.
  await deleteStoredFiles(
    [...expiredMedia, ...leftovers].flatMap((row) =>
      row.fileKey ? [row.fileKey] : [],
    ),
  );
  await Promise.all([
    ...(ids.length
      ? [
          client
            .delete(contentProposalMedia)
            .where(inArray(contentProposalMedia.proposalId, ids)),
          client
            .delete(contentProposalBasis)
            .where(inArray(contentProposalBasis.proposalId, ids)),
          client
            .delete(contentProposalChange)
            .where(inArray(contentProposalChange.proposalId, ids)),
          client.delete(contentProposal).where(inArray(contentProposal.id, ids)),
        ]
      : []),
    ...(leftovers.length
      ? [
          client.delete(contentProposalMedia).where(
            inArray(
              contentProposalMedia.id,
              leftovers.map((row) => row.id),
            ),
          ),
        ]
      : []),
  ]);
  return { removed: ids.length, filesDeleted: expiredMedia.length + leftovers.length };
};
