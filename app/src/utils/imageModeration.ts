/**
 * Policy for deciding whether an uploaded image (avatars, clan/ANBU images,
 * tavern uploads, ...) should be rejected based on an OpenAI omni-moderation
 * result.
 *
 * TNR is a ninja-themed game: swords, kunai, combat poses and red/blood-moon
 * colour schemes are normal character themes. OpenAI's `flagged` flag trips on
 * the generic `violence` category for exactly that kind of art, so we do not
 * rely on it. Instead we:
 * - always block sexual content, content involving minors, hate and self-harm
 * - only block `violence/graphic` when the model is highly confident (gore)
 * - never block on plain `violence` (fantasy weapons, fighting, red themes)
 */

/** Categories that block the upload whenever OpenAI flags them */
export const IMAGE_BLOCKING_CATEGORIES = [
  "sexual",
  "sexual/minors",
  "hate",
  "hate/threatening",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
] as const;

/**
 * Categories that block only above a (higher than default) score threshold.
 * `violence/graphic` at 0.8+ corresponds to explicit gore; lower scores are
 * typically weapons, blood-red colour palettes or stylised combat.
 */
export const IMAGE_SCORE_THRESHOLDS = {
  "violence/graphic": 0.8,
} as const;

type ImageModerationCategory =
  | (typeof IMAGE_BLOCKING_CATEGORIES)[number]
  | keyof typeof IMAGE_SCORE_THRESHOLDS
  | "violence";

/** Minimal shape of an OpenAI moderation result we depend on */
export type ImageModerationResult = {
  flagged?: boolean;
  categories: { [K in ImageModerationCategory]?: boolean | null };
  category_scores: { [K in ImageModerationCategory]?: number | null };
};

/**
 * Evaluate an image moderation result against the TNR image policy
 * @param result - The OpenAI moderation result (or undefined if none returned)
 * @returns Whether the image should be blocked, and the categories responsible
 */
export const evaluateImageModeration = (
  result: ImageModerationResult | undefined,
): { isNsfw: boolean; blockedCategories: string[]; reason: string } => {
  if (!result) {
    return { isNsfw: false, blockedCategories: [], reason: "Image passed moderation" };
  }
  const blocked = new Set<string>();
  for (const category of IMAGE_BLOCKING_CATEGORIES) {
    if (result.categories[category]) blocked.add(category);
  }
  for (const category of Object.keys(
    IMAGE_SCORE_THRESHOLDS,
  ) as (keyof typeof IMAGE_SCORE_THRESHOLDS)[]) {
    const score = result.category_scores[category] ?? 0;
    if (score >= IMAGE_SCORE_THRESHOLDS[category]) blocked.add(category);
  }
  const blockedCategories = [...blocked];
  return {
    isNsfw: blockedCategories.length > 0,
    blockedCategories,
    reason:
      blockedCategories.length > 0
        ? `Image flagged for: ${blockedCategories.join(", ")}`
        : "Image passed moderation",
  };
};
