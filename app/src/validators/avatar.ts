import { z } from "zod";

export const avatarUserDataSchema = z.object({
  avatar: z.string().nullable(),
  avatarLight: z.string().nullable(),
});
