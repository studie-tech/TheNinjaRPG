import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  find: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  identity: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock("@/server/db", () => ({
  drizzleDB: { query: { accountDeletion: { findMany: f.find } }, update: f.update },
}));
vi.mock("@/server/utils/accountDeletion/identity", () => ({
  removeAccountIdentity: f.identity,
}));
vi.mock("@/server/utils/accountDeletion/cleanup", () => ({
  removeAccountGameData: f.cleanup,
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

import { GET } from "@/app/api/account-deletions/route";

const req = (secret = "worker-test") =>
  new Request("https://www.theninja-rpg.com/api/account-deletions", {
    headers: { authorization: `Bearer ${secret}` },
  });

describe("deletion worker authorization and leases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "worker-test");
    f.find.mockResolvedValue([
      { userId: "user_test", phase: "QUEUED", appleRevokedSubject: null },
    ]);
    f.update.mockReturnValue({ set: f.set });
    f.set.mockReturnValue({ where: f.where });
    f.where.mockResolvedValue({ rowsAffected: 1 });
    f.identity.mockResolvedValue(undefined);
  });
  it("never scans or processes jobs without the worker secret", async () => {
    expect((await GET(req("wrong"))).status).toBe(401);
    expect(f.find).not.toHaveBeenCalled();
    expect(f.identity).not.toHaveBeenCalled();
  });
  it("performs no destructive action when another worker owns the lease", async () => {
    f.where.mockResolvedValueOnce({ rowsAffected: 0 });
    expect((await GET(req())).status).toBe(200);
    expect(f.identity).not.toHaveBeenCalled();
    expect(f.cleanup).not.toHaveBeenCalled();
  });
  it("does not run game cleanup during identity removal", async () => {
    expect((await GET(req())).status).toBe(200);
    expect(f.identity).toHaveBeenCalledWith("user_test", null);
    expect(f.cleanup).not.toHaveBeenCalled();
  });
  it("reports failure and retains a retry when identity removal fails", async () => {
    f.identity.mockRejectedValueOnce(new Error("provider unavailable"));
    const result = await GET(req());
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ processed: 0, failed: 1 });
    expect(f.cleanup).not.toHaveBeenCalled();
    expect(f.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ leaseId: null, leaseUntil: null }),
    );
  });
});
