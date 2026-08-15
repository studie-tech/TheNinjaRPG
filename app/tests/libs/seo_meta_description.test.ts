import { describe, expect, it } from "vitest";
import { metaDescription } from "@/libs/seo";

/**
 * Stored content descriptions contain HTML. Stripping entities rather than decoding them
 * turned "Don&apos;t" into "Don t" in the search snippet, and numeric forms survived
 * verbatim.
 */
describe("metaDescription", () => {
  it("decodes named entities", () => {
    expect(metaDescription("Don&apos;t drink the &amp; potion")).toBe(
      "Don't drink the & potion",
    );
  });

  it("decodes numeric and hex entities", () => {
    expect(metaDescription("Don&#39;t &#x26; win")).toBe("Don't & win");
  });

  it("leaves unknown entities untouched rather than blanking them", () => {
    expect(metaDescription("100&fakeentity; damage")).toBe("100&fakeentity; damage");
  });

  it("replaces numeric entities outside the Unicode range without throwing", () => {
    expect(() => metaDescription("bad &#x110000; entity")).not.toThrow();
    expect(metaDescription("bad &#x110000; entity")).toBe("bad � entity");
    expect(metaDescription("bad &#99999999; entity")).toBe("bad � entity");
  });

  it("replaces lone surrogates", () => {
    expect(metaDescription("half &#xD800; pair")).toBe("half � pair");
  });

  it("strips tags and collapses whitespace", () => {
    expect(metaDescription("<p>Hello</p>\n\n  <b>world</b>")).toBe("Hello world");
  });

  it("does not retain script or style contents", () => {
    expect(
      metaDescription(
        "<script>alert('x')</script><style>.hidden{display:none}</style><p>Hello</p>",
      ),
    ).toBe("Hello");
  });

  it("applies the prefix and truncates to a snippet length", () => {
    const long = "word ".repeat(80);
    const result = metaDescription(long, "A jutsu.");
    expect(result.startsWith("A jutsu. word")).toBe(true);
    expect(result.length).toBeLessThanOrEqual(160);
    expect(result.endsWith("...")).toBe(true);
  });
});
