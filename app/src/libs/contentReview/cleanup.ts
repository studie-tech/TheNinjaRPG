import { and, eq, inArray, isNotNull, isNull, lt, notExists, or } from "drizzle-orm";
import { CONTENT_PROPOSAL_RETENTION_DAYS } from "@/drizzle/constants";
import {
  contentProposal,
  contentProposalBasis,
  contentProposalChange,
  contentProposalMedia,
} from "@/drizzle/schema";
import type { DrizzleClient } from "@/server/db";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
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
  const expired = await client
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
  // The parent CAS decides whether retention or refinement wins. Orphan child rows are
  // durable cleanup work, so storage failures never require holding a database lock.
  const removed = expired.length
    ? (
        await retryOnDeadlock(() =>
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
            ),
        )
      ).rowsAffected
    : 0;
  // Read after claiming parents so this run also processes their newly orphaned media.
  // New submissions/refinements commit parents and children together, so an absent parent
  // cannot denote a draft still being saved. Applied/reverted drafts cannot be refined.
  const leftovers = await client
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
  const keys = leftovers.flatMap((row) => (row.fileKey ? [row.fileKey] : []));
  // Files first keeps orphan rows retryable, including a crash after the parent CAS.
  await deleteStoredFiles(keys);
  await Promise.all([
    ...(leftovers.length
      ? [
          retryOnDeadlock(() =>
            client.delete(contentProposalMedia).where(
              inArray(
                contentProposalMedia.id,
                leftovers.map((row) => row.id),
              ),
            ),
          ),
        ]
      : []),
    retryOnDeadlock(() =>
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
        .limit(BATCH),
    ),
    retryOnDeadlock(() =>
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
        .limit(BATCH),
    ),
  ]);
  return { removed, filesDeleted: keys.length };
};

/** Suggestions and leftover files handled per run; a bigger backlog clears over later runs. */
const BATCH = 500;

/** Approval routes can run for five minutes while saving content and media selections. */
const LEFTOVER_GRACE_S = 5 * 60;
