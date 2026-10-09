import { z } from "zod";
import { baseServerResponse } from "@/validators/base";

export const avatarUserDataSchema = z.object({
  avatar: z.string().nullable(),
  avatarLight: z.string().nullable(),
});

export const createAvatarOutputSchema = baseServerResponse.extend({
  data: avatarUserDataSchema.extend({ reputationPoints: z.number() }).optional(),
});

export const updateAvatarOutputSchema = baseServerResponse.extend({
  url: z.string().nullish(),
  data: avatarUserDataSchema.optional(),
});
