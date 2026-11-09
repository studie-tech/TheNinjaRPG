import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { processMentions } from "@/utils/chat";
import { parseHtml } from "@/utils/parse";
import { needsHtmlSource, richTextInput, splitQuotedReply } from "@/utils/richText";
import sanitize, { buildQuoteBlock } from "@/utils/sanitize";

const render = (html: string) => renderToStaticMarkup(parseHtml(sanitize(html)));

describe("rich-text HTML compatibility", () => {
  it("loads text literally and imports basic HTML with unsafe attributes removed", () => {
    expect(richTextInput("Hello < 3 & goodbye")).toEqual({
      text: "Hello < 3 & goodbye",
    });
    expect(
      richTextInput(
        '<p onclick="alert(1)"><strong>Hello</strong><script>alert(1)</script></p>',
      ),
    ).toEqual({ html: "<p><strong>Hello</strong></p>" });
    expect(
      needsHtmlSource(
        "<h2>Title</h2><p><strong>Hello</strong></p><ul><li>One</li></ul>",
      ),
    ).toBe(false);
    expect(needsHtmlSource('<a href="#custom">Jump to combat</a>')).toBe(false);
  });

  it("opens advanced existing documents in source mode", () => {
    for (const html of [
      '<iframe src="https://www.youtube.com/embed/id"></iframe>',
      "<table><tr><td>Cell</td></tr></table>",
      '<p style="color:red">Color</p>',
      '<blockquote author="Alice">Quote</blockquote>',
      '<h2 id="custom">Combat</h2>',
      '<h3 id="custom">Details</h3>',
      '<a name="custom"></a>',
      '<A href="#custom" NAME = "custom">Combat</A>',
      "[conceptart:some-id]",
    ]) {
      expect(needsHtmlSource(html)).toBe(true);
    }
  });

  it("retains semantic formatting and original image dimensions through sanitize and render", () => {
    const markup = render(
      '<h2>News</h2><p><strong>Bold</strong> <em>Italic</em> <u>Underline</u> <s>Strike</s></p><ol><li>First</li></ol><blockquote><p><strong>Quoted</strong></p></blockquote><img src="https://example.com/original.png" alt="Full size" width="1920" height="1080" onerror="alert(1)">',
    );
    expect(markup).toContain("text-xl font-bold");
    expect(markup).toContain("News</h2>");
    expect(markup).toContain("<strong>Bold</strong>");
    expect(markup).toContain("<em>Italic</em>");
    expect(markup).toContain("<u>Underline</u>");
    expect(markup).toContain("<s>Strike</s>");
    expect(markup).toContain("list-decimal pl-6");
    expect(markup).toContain("<li>First</li></ol>");
    expect(markup).toContain("border-l-4");
    expect(markup).toContain("<p><strong>Quoted</strong></p></blockquote>");
    expect(markup).toContain('href="https://example.com/original.png"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('width="1920"');
    expect(markup).toContain('height="1080"');
    expect(markup).toContain('alt="Full size"');
    expect(markup).not.toContain("onerror");
  });

  it("keeps authored image links without nesting anchors", () => {
    const markup = render(
      '<a href="https://example.com/gallery"><img src="https://example.com/original.png"></a>',
    );
    expect(markup.match(/<a /g)).toHaveLength(1);
    expect(markup).toContain('href="https://example.com/gallery"');
  });

  it("does not turn unsafe image sources into navigable links", () => {
    const markup = render('<img src="javascript:alert(1)" onload="alert(1)">');
    expect(markup).not.toContain("href=");
    expect(markup).not.toContain("javascript:");
    expect(markup).not.toContain("onload");
  });
});

describe("splitQuotedReply", () => {
  const quote =
    '<blockquote author="twix" date="11/04/2026"><p>only cuz someone asked</p></blockquote>';

  it("separates attached quotes from the message's own text", () => {
    const split = splitQuotedReply(`${quote}\n\n<p>add them to the blocklist xD</p>`);
    expect(split).toEqual({
      quotes: quote,
      reply: "<p>add them to the blocklist xD</p>",
      authors: ["twix"],
    });
    expect(needsHtmlSource(split.reply)).toBe(false);
  });

  it("keeps several quotes in order", () => {
    const second = '<blockquote author="Neon" date="11/05/2026"><p>hi</p></blockquote>';
    expect(splitQuotedReply(`${quote}${second}<p>both</p>`)).toEqual({
      quotes: `${quote}${second}`,
      reply: "<p>both</p>",
      authors: ["twix", "Neon"],
    });
  });

  it("leaves messages without an attached quote whole", () => {
    expect(
      splitQuotedReply("<p>plain</p><blockquote>typed quote</blockquote>"),
    ).toEqual({
      quotes: "",
      reply: "<p>plain</p><blockquote>typed quote</blockquote>",
      authors: [],
    });
  });
});

describe("buildQuoteBlock", () => {
  const quoted = {
    id: "comment-1",
    username: "Bob",
    createdAt: new Date(2026, 10, 5, 12),
    content:
      '<blockquote author="Ann">old</blockquote><p>See <img src="https://utfs.io/f/a.png"></p>',
  };

  it("attributes the quote and names the quoted message, without its own quotes", () => {
    expect(buildQuoteBlock(quoted)).toBe(
      '<blockquote author="Bob" date="11/05/2026" data-comment-id="comment-1"><p>See <img src="https://utfs.io/f/a.png" /></p></blockquote>',
    );
  });

  it("keeps generated IDs while stripping authored IDs before attaching quotes", () => {
    const authored =
      '<p>Reply</p><blockquote author="Other" data-comment-id="forged">Fake</blockquote>';
    const content =
      buildQuoteBlock(quoted) + processMentions(authored).processedContent;
    expect(content).toContain('data-comment-id="comment-1"');
    expect(content).not.toContain('data-comment-id="forged"');
    expect(renderToStaticMarkup(parseHtml(content))).toContain(
      "Jump to the quoted message from Bob",
    );
  });

  it("names an unknown author", () => {
    expect(buildQuoteBlock({ ...quoted, username: null })).toStartWith(
      '<blockquote author="Unknown"',
    );
  });

  it("keeps an author name with quotes and markup inside its attribute", () => {
    const username = 'Ai "<b>" data-comment-id="other" & co';
    const html = buildQuoteBlock({ ...quoted, username });
    const quote = new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector("blockquote");
    expect(quote?.getAttribute("author")).toBe(username);
    expect(quote?.getAttribute("data-comment-id")).toBe("comment-1");
    expect(splitQuotedReply(`${html}<p>reply</p>`).authors).toEqual([username]);
  });
});
