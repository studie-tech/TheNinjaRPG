import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { forumBoardIntro, forumThreadIntro, publicUserIntro } from "@/layout/seoTexts";
import { htmlToPlainText } from "@/utils/sanitize";

// The same strip-and-decode the site uses for meta descriptions, so an entity in a
// board name ("Questions & Answers") reads back as the character it stands for.
const text = (node: React.ReactNode) => htmlToPlainText(renderToStaticMarkup(<>{node}</>));

describe("entity-page intros", () => {
  // Search Console filed 395 forum threads and several profiles as duplicates of one
  // another. The cause was a four-paragraph pitch rendered verbatim on every one of them:
  // 1,892 characters of identical copy against, on a typical thread, 2,400 of posts.
  // Google's near-duplicate detection is body-weighted, so the boilerplate outweighed the
  // content. The replacements must stay short, and must name the thing the page is about
  // so no two pages render the same body.
  it("names the entity, so no two pages share a body", () => {
    expect(text(forumThreadIntro("Rank Loadout: PVE Jutsu"))).toContain(
      "Rank Loadout: PVE Jutsu",
    );
    expect(text(forumBoardIntro("Questions & Answers"))).toContain("Questions & Answers");
    expect(text(publicUserIntro("Terriator"))).toContain("Terriator");
    expect(text(publicUserIntro("Terriator"))).not.toEqual(text(publicUserIntro("Lucy")));
  });

  it("stays a fraction of the body it sits above", () => {
    // The pitch these replaced was 1,892 characters. A ceiling well under a typical
    // thread's or profile's own content keeps the unique part dominant.
    for (const node of [
      forumThreadIntro("A thread title of ordinary length"),
      forumBoardIntro("Shinobi University"),
      publicUserIntro("SomeUsername"),
    ]) {
      expect(text(node).length).toBeLessThan(450);
    }
  });

  it("links a signed-out visitor somewhere useful", () => {
    for (const node of [forumThreadIntro("t"), forumBoardIntro("b"), publicUserIntro("u")]) {
      expect(renderToStaticMarkup(<>{node}</>)).toContain('href="/signup"');
    }
  });
});
