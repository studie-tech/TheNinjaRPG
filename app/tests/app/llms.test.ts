import { describe, expect, it } from "bun:test";
import { GET } from "@/app/llms.txt/route";
import { SITE_DESCRIPTION, SITE_URL } from "@/libs/seo";

describe("public game reference directory", () => {
  it("returns readable text with canonical links to public references", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const body = await response.text();
    expect(body).toContain(SITE_DESCRIPTION);
    const links = [...body.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map(
      (match) => new URL(match[1]!),
    );
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) {
      expect(link.origin).toBe(SITE_URL);
      expect(link.search).toBe("");
      expect(link.pathname).not.toMatch(/^\/(api|profile|register)(\/|$)/);
    }
    expect(links.some((link) => link.pathname === "/guide/getting-started")).toBe(true);
    expect(links.some((link) => link.pathname === "/manual/combat")).toBe(true);
  });
});
