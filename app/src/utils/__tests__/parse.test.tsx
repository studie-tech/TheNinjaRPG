// @vitest-environment node
//
// These run in the Node environment on purpose: `/news`, `/forum` and the
// conversation pages are server-rendered, so `parseHtml` output has to survive
// `renderToString` without any DOM globals.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
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

  it("survives a blockquote nested inside a blockquote", () => {
    expect(() =>
      render("<blockquote>outer <blockquote>inner</blockquote></blockquote>"),
    ).not.toThrow();
  });
});
