import { afterEach, expect, it, vi } from "bun:test";
import { GET, PATCH } from "@/app/api/content-review/proposals/[id]/route";
import { resetServerModuleStubs, stubDatabase } from "../../setup/serverModules";

const originalCronSecret = process.env.CRON_SECRET;
const context = { params: Promise.resolve({ id: "proposal-id" }) };
afterEach(() => { if (originalCronSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = originalCronSecret; resetServerModuleStubs(); });
it("authenticates before reading a proposal or parsing a revision", async () => {
  process.env.CRON_SECRET = "test-secret";
  const read = vi.fn();
  stubDatabase({ query: { contentProposal: { findFirst: read } } });
  expect((await GET(new Request("https://example.com"), context)).status).toBe(401);
  expect((await PATCH(new Request("https://example.com", { method: "PATCH", body: "bad JSON" }), context)).status).toBe(401);
  expect(read).not.toHaveBeenCalled();
});
it("returns the current token with no-store and refuses malformed revisions", async () => {
  process.env.CRON_SECRET = "test-secret";
  const headers = { authorization: "Bearer test-secret" };
  const read = vi.fn().mockResolvedValue({ id: "proposal-id", statusChangedAt: new Date("2026-10-02T00:00:00.000Z") });
  stubDatabase({ query: { contentProposal: { findFirst: read } } });
  const result = await GET(new Request("https://example.com", { headers }), context);
  expect(result.headers.get("Cache-Control")).toBe("no-store");
  expect(await result.json()).toMatchObject({ statusChangedAt: "2026-10-02T00:00:00.000Z" });
  read.mockClear();
  expect((await PATCH(new Request("https://example.com", { headers, method: "PATCH", body: "{}" }), context)).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});
