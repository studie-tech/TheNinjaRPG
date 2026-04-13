import { z } from "zod";
import { UserRanks } from "@/drizzle/constants";

export const aiTestUserProfileSchema = z
  .object({
    key: z.string().trim().min(1).max(64),
    level: z.coerce.number().int().min(1).max(200),
    rank: z.enum(UserRanks),
    villageId: z.string().trim().min(1).max(191).optional(),
    villageName: z.string().trim().min(1).max(191).optional(),
    preferredUsername: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9_]{3,24}$/)
      .optional(),
    isBanned: z.boolean().optional(),
  })
  .refine((value) => value.villageId || value.villageName, {
    error: "Either villageId or villageName must be provided",
    path: ["villageId"],
  });

const normalizeUserKey = (value: string) =>
  value.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();

export const aiTestUserRequestSchema = z
  .object({
    runId: z.string().trim().min(1).max(64).optional(),
    users: z.array(aiTestUserProfileSchema).min(1).max(4),
  })
  .superRefine(({ users }, ctx) => {
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
