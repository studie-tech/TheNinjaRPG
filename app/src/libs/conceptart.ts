import { and, eq, isNotNull, or } from "drizzle-orm";
import { conceptImage } from "@/drizzle/schema";

/**
 * Public concept-art pages are indexable only after their requested media exists.
 * Video jobs keep their thumbnail when finalization fails, so `done` plus `image` is
 * not sufficient for them.
 */
export const indexableConceptArt = and(
  eq(conceptImage.done, true),
  isNotNull(conceptImage.image),
  isNotNull(conceptImage.userId),
  eq(conceptImage.hidden, false),
  or(
    eq(conceptImage.mediaType, "image"),
    and(eq(conceptImage.mediaType, "video"), isNotNull(conceptImage.video)),
  ),
);
