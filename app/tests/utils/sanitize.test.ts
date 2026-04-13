import { expect, test } from "vitest";
import { stripBlockquotes } from "@/utils/sanitize";

test("stripBlockquotes removes blockquotes and their nested content", () => {
  expect(
    stripBlockquotes(
      'Intro <blockquote author="A">Parent <blockquote author="B">Child</blockquote></blockquote> More',
    ),
  ).toBe("Intro  More");
});

test("stripBlockquotes preserves non-quote sanitized html", () => {
  expect(stripBlockquotes("<p>Hello <strong>there</strong></p>")).toBe(
    "<p>Hello <strong>there</strong></p>",
  );
});
