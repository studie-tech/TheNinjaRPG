import { expect, test } from "vitest";
import { htmlToPlainText, stripBlockquotes } from "@/utils/sanitize";

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

test("stripBlockquotes removes blockquotes and their nested content", () => {
  expect(
    normalizeWhitespace(
      stripBlockquotes(
        'Intro <blockquote author="A">Parent <blockquote author="B">Child</blockquote></blockquote> More',
      ),
    ),
  ).toBe("Intro More");
});

test("stripBlockquotes removes multiple sibling blockquotes", () => {
  expect(
    normalizeWhitespace(
      stripBlockquotes(
        'Start <blockquote author="A">First</blockquote><blockquote author="B">Second</blockquote> End',
      ),
    ),
  ).toBe("Start End");
});

test("stripBlockquotes returns an empty string for empty or quote-only input", () => {
  expect(stripBlockquotes("")).toBe("");
  expect(
    stripBlockquotes('<blockquote author="A" date="04/12/2026">Only quote</blockquote>'),
  ).toBe("");
});

test("stripBlockquotes preserves text adjacent to removed quotes", () => {
  expect(
    normalizeWhitespace(
      stripBlockquotes('Before<blockquote author="A">Quote</blockquote>After'),
    ),
  ).toBe("BeforeAfter");
});

test("stripBlockquotes preserves non-quote sanitized html", () => {
  expect(stripBlockquotes("<p>Hello <strong>there</strong></p>")).toBe(
    "<p>Hello <strong>there</strong></p>",
  );
});

test("stripBlockquotes preserves non-quote media tags around blockquotes", () => {
  expect(
    stripBlockquotes(
      '<img src="avatar.png" /><blockquote author="A">Quoted</blockquote><iframe src="https://example.com/embed"></iframe>',
    ),
  ).toBe(
    '<img src="avatar.png" /><iframe src="https://example.com/embed"></iframe>',
  );
});

test("htmlToPlainText parses entities and separates block content", () => {
  expect(
    htmlToPlainText("<p>Don&apos;t<br>fight</p><p>AT&amp;T &copy; 2026</p>"),
  ).toBe("Don't fight AT&T © 2026");
});

test("htmlToPlainText discards script and style contents", () => {
  expect(
    htmlToPlainText(
      "<script>alert('x')</script><style>.hidden{display:none}</style><p>Visible</p>",
    ),
  ).toBe("Visible");
});
