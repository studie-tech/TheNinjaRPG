import * as sentry from "@sentry/nextjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processAccountDeletions } from "@/server/utils/accountDeletion/process";
import {
  resetServerModuleStubs,
  stubDatabase,
} from "../../../../../tests/setup/serverModules";
import * as cleanup from "../cleanup";
import * as identity from "../identity";

const f = {
  find: vi.fn(),
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  identity: vi.fn(),
  cleanup: vi.fn(),
};
afterEach(() => {
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

describe("shared deletion processor leases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDatabase({
      query: { accountDeletion: { findMany: f.find } },
      update: f.update,
    });
    vi.spyOn(identity, "removeAccountIdentity").mockImplementation(f.identity);
    vi.spyOn(cleanup, "removeAccountGameData").mockImplementation(f.cleanup);
    vi.spyOn(sentry, "captureException").mockReturnValue("test");
    f.find.mockResolvedValue([
      { userId: "user_test", phase: "QUEUED", appleRevokedSubject: null },
    ]);
    f.update.mockReturnValue({ set: f.set });
    f.set.mockReturnValue({ where: f.where });
    f.where.mockResolvedValue({ rowsAffected: 1 });
    f.identity.mockResolvedValue(undefined);
  });
  it("returns a retryable failure when the queue cannot be read", async () => {
    f.find.mockRejectedValueOnce(new Error("database unavailable"));
    expect(await processAccountDeletions("user_test")).toEqual({
      processed: 0,
      failed: 1,
    });
    expect(f.identity).not.toHaveBeenCalled();
  });
  it("performs no destructive action when another worker owns the lease", async () => {
    f.where.mockResolvedValueOnce({ rowsAffected: 0 });
    expect(await processAccountDeletions()).toMatchObject({ failed: 0 });
    expect(f.identity).not.toHaveBeenCalled();
    expect(f.cleanup).not.toHaveBeenCalled();
  });
  it("does not run game cleanup during identity removal", async () => {
    expect(await processAccountDeletions()).toMatchObject({ failed: 0 });
    expect(f.identity).toHaveBeenCalledWith("user_test", null);
    expect(f.cleanup).not.toHaveBeenCalled();
  });
  it("reports failure and retains a retry when identity removal fails", async () => {
    f.identity.mockRejectedValueOnce(new Error("provider unavailable"));
    expect(await processAccountDeletions()).toEqual({ processed: 0, failed: 1 });
    expect(f.cleanup).not.toHaveBeenCalled();
    expect(f.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ leaseId: null, leaseUntil: null }),
    );
  });
});
