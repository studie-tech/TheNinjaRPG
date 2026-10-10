import { expect, test } from "bun:test";
import {
  evaluateImageModeration,
  type ImageModerationResult,
} from "@/utils/imageModeration";

const makeResult = (
  categories: Record<string, boolean> = {},
  scores: Record<string, number> = {},
): ImageModerationResult => ({
  flagged: Object.values(categories).some(Boolean),
  categories: {
    sexual: false,
    "sexual/minors": false,
    hate: false,
    "hate/threatening": false,
    "self-harm": false,
    "self-harm/intent": false,
    "self-harm/instructions": false,
    violence: false,
    "violence/graphic": false,
    ...categories,
  },
  category_scores: { violence: 0, "violence/graphic": 0, sexual: 0, ...scores },
});

test("evaluateImageModeration allows an image with no moderation result", () => {
  expect(evaluateImageModeration(undefined).isNsfw).toBe(false);
});

test("evaluateImageModeration allows clean images", () => {
  const verdict = evaluateImageModeration(makeResult());
  expect(verdict.isNsfw).toBe(false);
  expect(verdict.reason).toBe("Image passed moderation");
});

test("evaluateImageModeration does not block ninja art flagged only for violence", () => {
  // e.g. a character holding a sword, or a red colour scheme
  const verdict = evaluateImageModeration(
    makeResult({ violence: true }, { violence: 0.97, "violence/graphic": 0.3 }),
  );
  expect(verdict.isNsfw).toBe(false);
  expect(verdict.blockedCategories).toEqual([]);
});

test("evaluateImageModeration does not block low-confidence violence/graphic", () => {
  const verdict = evaluateImageModeration(
    makeResult(
      { violence: true, "violence/graphic": true },
      { violence: 0.9, "violence/graphic": 0.6 },
    ),
  );
  expect(verdict.isNsfw).toBe(false);
});

test("evaluateImageModeration blocks high-confidence graphic violence (gore)", () => {
  const verdict = evaluateImageModeration(
    makeResult({ "violence/graphic": true }, { "violence/graphic": 0.92 }),
  );
  expect(verdict.isNsfw).toBe(true);
  expect(verdict.blockedCategories).toEqual(["violence/graphic"]);
  expect(verdict.reason).toBe("Image flagged for: violence/graphic");
});

test("evaluateImageModeration always blocks sexual content", () => {
  const verdict = evaluateImageModeration(
    makeResult({ sexual: true, violence: true }, { sexual: 0.55 }),
  );
  expect(verdict.isNsfw).toBe(true);
  expect(verdict.blockedCategories).toEqual(["sexual"]);
});

test("evaluateImageModeration always blocks sexual/minors, hate and self-harm", () => {
  for (const category of [
    "sexual/minors",
    "hate",
    "hate/threatening",
    "self-harm",
    "self-harm/intent",
    "self-harm/instructions",
  ]) {
    const verdict = evaluateImageModeration(makeResult({ [category]: true }));
    expect(verdict.isNsfw).toBe(true);
    expect(verdict.blockedCategories).toContain(category);
  }
});
