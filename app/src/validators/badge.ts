import { z } from "zod";

export const BadgeValidator = z.object({
  name: z.string().trim().min(1).max(191),
  image: z.url(),
  description: z.string().min(1).max(500),
});

export type ZodBadgeType = z.infer<typeof BadgeValidator>;

// Stored badges can predate today's form constraints (notably, badge.create starts with an
// empty description). Keep the concurrency snapshot lossless and validate only database
// bounds here; submitted edits still use the stricter BadgeValidator above.
export const badgeSnapshotSchema = z.object({
  id: z.string().min(1).max(191),
  name: z.string().min(1).max(191),
  image: z.string().max(191),
  description: z.string().max(500),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type BadgeSnapshot = z.infer<typeof badgeSnapshotSchema>;

/**
 * A badge edit is a full-document setter. The original document and revision make a stale
 * browser tab detectable, while the request ID makes a lost-success response safe to retry.
 */
export const updateBadgeSchema = z
  .object({
    id: z.string().min(1).max(191),
    expectedUpdatedAt: z.date(),
    expectedBadge: badgeSnapshotSchema,
    data: BadgeValidator,
    requestId: z.string().uuid(),
  })
  .superRefine((request, ctx) => {
    if (request.id !== request.expectedBadge.id) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedBadge", "id"],
        message: "Badge snapshot does not match the requested badge",
      });
    }
    if (
      request.expectedUpdatedAt.getTime() !== request.expectedBadge.updatedAt.getTime()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedBadge", "updatedAt"],
        message: "Badge snapshot does not match the requested revision",
      });
    }
  });

export type UpdateBadge = z.infer<typeof updateBadgeSchema>;
