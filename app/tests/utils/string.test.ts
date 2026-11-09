import { describe, expect, it } from "bun:test";
import { stripHtmlPreview } from "@/utils/string";

describe("stripHtmlPreview", () => {
  it("separates block text and collapses whitespace", () => {
    expect(stripHtmlPreview("<p>Line one</p>\n<p>Line  two</p>")).toBe(
      "Line one Line two",
    );
  });

  it("decodes the entities sanitized content carries", () => {
    expect(
      stripHtmlPreview("Rock&nbsp;&amp;&nbsp;roll &lt;3 &quot;it&#39;s&quot;"),
    ).toBe(`Rock & roll <3 "it's"`);
  });

  it("decodes once, so escaped entities stay literal", () => {
    expect(stripHtmlPreview("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
  });

  it("does not turn encoded markup back into tags to strip", () => {
    expect(stripHtmlPreview("&lt;b&gt;bold&lt;/b&gt;")).toBe("<b>bold</b>");
  });

  it("treats a missing value as empty", () => {
    expect(stripHtmlPreview(null)).toBe("");
  });
});
