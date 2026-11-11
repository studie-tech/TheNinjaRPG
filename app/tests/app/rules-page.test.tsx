import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import GameRules from "@/app/[shell]/rules/page";
import * as ContentBox from "@/layout/ContentBox";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("gives every rule heading a stable anchor that the table of contents links to", () => {
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  const view = render(<GameRules />);
  const headings = [...view.container.querySelectorAll("h2, h3")];
  const ids = headings.map((heading) => heading.id);
  expect(ids).toContain("rule-4-3");
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every((id) => /^rule-\d+(-\d+)*$/.test(id))).toBe(true);
  const links = [
    ...view.container.querySelectorAll('nav[aria-label="On this page"] a'),
  ].map((link) => link.getAttribute("href")?.slice(1));
  expect(links.length).toBe(
    headings.filter((heading) => heading.tagName === "H2").length,
  );
  for (const id of links) expect(ids).toContain(id!);
  expect(view.container.innerHTML).not.toContain("&nbsp;");
});
