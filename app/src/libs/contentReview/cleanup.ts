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
  // A suggestion's own row goes last: runs select from it, so if a child delete fails, the
  // next run finds the suggestion again and finishes the job.
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
  if (ids.length) {
    await client.delete(contentProposal).where(inArray(contentProposal.id, ids));
  }
  return { removed: ids.length, filesDeleted: expiredMedia.length + leftovers.length };
};

/** Suggestions and leftover files handled per run; a bigger backlog clears over later runs. */
const BATCH = 500;
