import { z } from "zod";
import { AvatarFacings, SpriteGenerationMotions } from "@/drizzle/constants";
import { SpriteCharacterStyles } from "@/libs/spriteStudio";

/** gameasset.dev accepts 4n+1 clips; these give 8x2 and 8x3 sheets. */
const clipFrames = z.union([z.literal(33), z.literal(49)]);

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

/** One animation request; the router resolves the source and spends the credits. */
export const generateSpriteSchema = z.object({
  source: spriteSourceSchema,
  name: z.string().trim().min(1).max(191),
  prompt: z.string().trim().min(3).max(2000),
  motion: z.enum(SpriteGenerationMotions),
  frames: clipFrames,
});

/** A description of a new character, drawn as four candidates to choose from. */
export const spriteCharacterSchema = z.object({
  prompt: z.string().trim().min(3).max(1000),
  style: z.enum(SpriteCharacterStyles),
});

export type SpriteSource = z.infer<typeof spriteSourceSchema>;
