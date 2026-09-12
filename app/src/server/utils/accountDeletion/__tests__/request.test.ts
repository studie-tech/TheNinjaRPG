import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  save: vi.fn(),
  find: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: mocks.auth,
  reverificationErrorResponse: () =>
    new Response(
      JSON.stringify({ clerk_error: { code: "session_reverification_required" } }),
      { status: 403 },
    ),
}));
vi.mock("@/server/db", () => ({
  drizzleDB: {
    insert: mocks.insert,
    query: { accountDeletion: { findFirst: mocks.find } },
  },
}));
vi.mock("@/server/utils/accountDeletion/apple", () => ({
  prepareAppleDeletion: mocks.prepare,
}));

import { POST } from "@/app/api/native/account-deletion/route";

const body = {
  expectedUserId: "user_test",
  confirmation: "DELETE MY ACCOUNT",
  understandsPermanentLoss: true,
  understandsSubscriptions: true,
};
const request = (input: unknown = body, ua = "TNR-Native/1.0 (ios)") =>
  new Request("https://www.theninja-rpg.com/api/native/account-deletion", {
    method: "POST",
    headers: { "user-agent": ua, "content-type": "application/json" },
    body: JSON.stringify(input),
  });

describe("native account deletion authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-worker-secret");
    vi.stubEnv("NATIVE_ACCOUNT_DELETION_ENABLED", "true");
    mocks.find.mockResolvedValue(undefined);
    mocks.prepare.mockResolvedValue(null);
    mocks.auth.mockResolvedValue({ userId: "user_test", has: () => true });
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ onDuplicateKeyUpdate: mocks.save });
    mocks.save.mockResolvedValue({ rowsAffected: 1 });
  });
  it("rejects ordinary web requests", async () => {
    expect((await POST(request(body, "Mozilla/5.0"))).status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("does not mistake a forged shell marker for authentication", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("requires recent server-verified identity", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_test", has: () => false });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it.each([
    { ...body, expectedUserId: "user_other" },
    { ...body, confirmation: "delete" },
    { ...body, understandsSubscriptions: false },
    { ...body, understandsPermanentLoss: false },
  ])("rejects incomplete or switched-account confirmation", async (input) => {
    expect((await POST(request(input))).status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("refuses to enqueue when cleanup is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("only queues the authenticated identity, idempotently", async () => {
    expect((await POST(request())).status).toBe(202);
    expect(mocks.values).toHaveBeenCalledWith({
      userId: "user_test",
      appleRevokedSubject: null,
    });
    expect(mocks.save).toHaveBeenCalledWith({ set: { userId: "user_test" } });
  });
  it("does not report success after an enqueue failure", async () => {
    mocks.save.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await POST(request())).status).toBe(503);
  });
  it("reuses a saved request without re-consuming an Apple authorization code", async () => {
    mocks.find.mockResolvedValueOnce({ userId: "user_test" });
    expect((await POST(request())).status).toBe(202);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("does not enqueue when Apple ownership/revocation cannot be verified", async () => {
    mocks.prepare.mockRejectedValueOnce(new Error("Apple unavailable"));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
