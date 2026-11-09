// `/news`, `/forum` and the conversation pages are server-rendered, so `parseHtml`
// output has to survive `renderToString` without any DOM globals. The suite removes
// the preloaded jsdom globals it would otherwise inherit and restores them afterwards.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { Quote } from "@/components/ui/quote";
import { parseHtml } from "@/utils/parse";

const domGlobals = ["window", "document", "DOMParser"] as const;
const savedGlobals = new Map<string, PropertyDescriptor>();

beforeAll(() => {
  for (const key of domGlobals) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    if (descriptor) savedGlobals.set(key, descriptor);
    Reflect.deleteProperty(globalThis, key);
  }
});

afterAll(() => {
  for (const [key, descriptor] of savedGlobals) Object.defineProperty(globalThis, key, descriptor);
});

// parseHtml returns an array of nodes, so it needs a host element to render into.
const render = (html: string) => renderToString(<div>{parseHtml(html)}</div>);

describe("parseHtml during server rendering", () => {
  it("renders a blockquote without needing a DOM", () => {
    expect([typeof window, typeof document, typeof DOMParser]).toEqual(["undefined", "undefined", "undefined"]);
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

  it("renders HTML strings supplied by the quote composer", () => {
    const html = renderToString(
      <Quote author="Bob">{"<p>look <strong>here</strong></p>"}</Quote>,
    );
    expect(html).toContain("<strong>here</strong>");
  });

  it("applies post media transforms and filtering inside attributed quotes", () => {
    const content = '<h1>Heading</h1><script>alert(1)</script><iframe src="https://example.com/embed"></iframe><iframe src="https://www.youtube.com/embed/id"></iframe>[conceptart:gallery-1]';
    expect(parseHtml(`<blockquote author="Bob">${content}</blockquote>`)).toMatchObject([
      { type: Quote, props: { children: parseHtml(content) } },
    ]);
  });

  it("offers a jump to the quoted message when the quote names it", () => {
    const html = render('<blockquote author="Bob" date="11/05/2026" data-comment-id="c1">hi</blockquote>');
    expect(html).toMatch(/<button[^>]+aria-label="Jump to the quoted message from Bob"/);
  });

  it("shows an older quote without a jump", () => {
    expect(render('<blockquote author="Bob" date="11/05/2026">hi</blockquote>')).not.toContain("<button");
  });

  it("survives a blockquote nested inside a blockquote", () => {
    expect(() =>
      render("<blockquote>outer <blockquote>inner</blockquote></blockquote>"),
    ).not.toThrow();
  });
});
