import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  aiText,
  bloodlineText,
  itemText,
  jutsuText,
  publicUserIntro,
} from "@/layout/seoTexts";
import { htmlToPlainText } from "@/utils/sanitize";

// Use the same text decoding as page meta descriptions.
const text = (node: React.ReactNode) =>
  htmlToPlainText(renderToStaticMarkup(<>{node}</>));

describe("public profile intro", () => {
  it("names the player, so profiles have distinct intro content", () => {
    expect(text(publicUserIntro("Terriator"))).toContain("Terriator");
    expect(text(publicUserIntro("Terriator"))).not.toEqual(
      text(publicUserIntro("Lucy")),
    );
  });

  it("stays a fraction of the body it sits above", () => {
    // Keep the profile's own content dominant.
    expect(text(publicUserIntro("SomeUsername")).length).toBeLessThan(450);
  });

  it("links a signed-out visitor somewhere useful", () => {
    expect(renderToStaticMarkup(<>{publicUserIntro("u")}</>)).toContain(
      'href="/signup"',
    );
  });
});

describe("entity texts", () => {
  it.each([
    ["bloodline", bloodlineText],
    ["jutsu", jutsuText],
    ["item", itemText],
    ["ai", aiText],
  ])("punctuates the %s community links", (_, entityText) => {
    expect(text(entityText("Name"))).not.toContain(" ,");
  });
});
