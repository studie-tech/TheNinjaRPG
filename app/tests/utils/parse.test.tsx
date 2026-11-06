//
// These run in the Node environment on purpose: `/news`, `/forum` and the
// conversation pages are server-rendered, so `parseHtml` output has to survive
// `renderToString` without any DOM globals.

import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { parseHtml } from "@/utils/parse";

// parseHtml returns an array of nodes, so it needs a host element to render into.
const render = (html: string) => renderToString(<div>{parseHtml(html)}</div>);

describe("parseHtml during server rendering", () => {
  it("renders a blockquote without needing a DOM", () => {
    expect(() => render("<blockquote>hello</blockquote>")).not.toThrow();
  });

  it("keeps the quoted text", () => {
    expect(render('<blockquote author="Bob">hello there</blockquote>')).toContain(
      "hello there",
    );
  });

  it("decodes entities in quoted text", () => {
    expect(render("<blockquote>a &amp; b</blockquote>")).toContain("a &amp; b");
  });

  it("renders the quote author", () => {
    expect(render('<blockquote author="Bob">hi</blockquote>')).toContain("Bob");
  });

  it("shows an image inside an attributed quote", () => {
    const html = render(
      '<blockquote author="Bob" date="11/05/2026"><img src="https://utfs.io/f/shot.png" width="300" height="200"></blockquote>',
    );
    expect(html).toMatch(/Quoted from (<!-- -->)?Bob/);
    expect(html).toMatch(/<img[^>]+src="https:\/\/utfs\.io\/f\/shot\.png"/);
  });

  it("keeps the quoted text and formatting around a quoted image", () => {
    const html = render(
      '<blockquote author="Bob"><p>look <strong>here</strong> &amp; there</p><img src="https://utfs.io/f/a.png"></blockquote>',
    );
    expect(html).toContain("<strong>here</strong>");
    expect(html).toContain("&amp; there");
    expect(html).toMatch(/<img[^>]+src="https:\/\/utfs\.io\/f\/a\.png"/);
  });

  it("keeps escaped markup inside a quote as text", () => {
    const html = render('<blockquote author="Bob"><p>a &lt;b&gt; "c"</p></blockquote>');
    expect(html).toContain("a &lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("survives a blockquote nested inside a blockquote", () => {
    expect(() =>
      render("<blockquote>outer <blockquote>inner</blockquote></blockquote>"),
    ).not.toThrow();
  });
});
