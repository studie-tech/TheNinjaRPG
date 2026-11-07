import { z } from "zod";
import { AvatarFacings } from "@/drizzle/constants";

/** The art an animation starts from: an AI's image, an upload or a drawn candidate. */
export const spriteSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ai"),
    userId: z.string().min(1),
    actionKey: z.string().min(1).max(191),
  }),
  z.object({
    kind: z.literal("upload"),
    url: z.url().max(2048),
    facing: z.enum(AvatarFacings),
  }),
  z.object({
    kind: z.literal("candidate"),
    imageId: z.string().min(1).max(100),
    url: z.url().max(2048),
    facing: z.enum(AvatarFacings),
  }),
]);

export type SpriteSource = z.infer<typeof spriteSourceSchema>;
