/**
 * Zod schemas for the AI test-user broker API (`/api/ai-test-user`).
 *
 * Shared between the Next.js route handler (server) and the Codex agent's
 * curl-based requests, so the shape is kept intentionally simple / JSON-safe.
 */
import { z } from "zod";
import { UserRanks } from "@/drizzle/constants";

/** Describes a single test user the agent wants provisioned. */
export const aiTestUserProfileSchema = z
  .object({
    /** Unique label for this user within the request (e.g. "attacker", "defender"). */
    key: z.string().trim().min(1).max(64),
    level: z.coerce.number().int().min(1).max(200),
    rank: z.enum(UserRanks),
    /** Look up village by ID — takes precedence over villageName. */
    villageId: z.string().trim().min(1).max(191).optional(),
    /** Look up village by display name (e.g. "Shine"). */
    villageName: z.string().trim().min(1).max(191).optional(),
    /** Optional Clerk username override; must be alphanumeric 3-24 chars. */
    preferredUsername: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_]{3,24}$/)
      .optional(),
    /** Set true to provision a banned user (for testing ban flows). */
    isBanned: z.boolean().optional(),
  })
  .refine((value) => value.villageId || value.villageName, {
    error: "Either villageId or villageName must be provided",
    path: ["villageId"],
  });

/** Collapse non-alphanumeric chars so "Red Team" and "red_team" are treated as dupes. */
const normalizeUserKey = (value: string) =>
  value.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();

/** Broker request: one or more user profiles plus an optional run identifier. */
export const aiTestUserRequestSchema = z
  .object({
    /** Ties provisioned users to a specific CI run for deterministic reuse. */
    runId: z.string().trim().min(1).max(64).optional(),
    /** Up to 4 users per request to keep provisioning time bounded. */
    users: z.array(aiTestUserProfileSchema).min(1).max(4),
  })
  .superRefine(({ users }, ctx) => {
    // Reject keys that would collide after normalisation (e.g. "Red Team" vs "red_team")
    // to prevent race conditions in Clerk user creation
    const seen = new Set<string>();
    for (const [index, user] of users.entries()) {
      const normalized = normalizeUserKey(user.key);
      if (seen.has(normalized)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate user key after normalization: "${normalized}"`,
          path: ["users", index, "key"],
        });
      }
      seen.add(normalized);
    }
  });

/** Broker response: provisioned user credentials, sign-in tokens, and version tag. */
export const aiTestUserResponseSchema = z.object({
  success: z.boolean(),
  users: z.array(
    z.object({
      key: z.string(),
      userId: z.string(),
      username: z.string(),
      email: z.string(),
      password: z.string(),
      level: z.number().int(),
      rank: z.enum(UserRanks),
      villageId: z.string(),
      villageName: z.string(),
      isBanned: z.boolean(),
      signInToken: z.string().optional(),
    }),
  ),
  testingToken: z.string().optional(),
  version: z.string().optional(),
});

export type AiTestUserRequest = z.infer<typeof aiTestUserRequestSchema>;
export type AiTestUserProfile = z.infer<typeof aiTestUserProfileSchema>;
export type AiTestUserResponse = z.infer<typeof aiTestUserResponseSchema>;
