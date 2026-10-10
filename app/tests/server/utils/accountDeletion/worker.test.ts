import { describe, expect, it, vi } from "bun:test";
import { runDeletionStep } from "@/server/utils/accountDeletion/worker";

describe("permanent account deletion ordering", () => {
  const effects = () => ({
    removeIdentity: vi.fn().mockResolvedValue(undefined),
    removeGameData: vi.fn().mockResolvedValue(undefined),
    advance: vi.fn().mockResolvedValue(undefined),
  });
  it("revokes identity before allowing delayed game cleanup", async () => {
    const f = effects();
    await runDeletionStep({ phase: "QUEUED", ...f });
    expect(f.removeIdentity).toHaveBeenCalledTimes(1);
    expect(f.removeGameData).not.toHaveBeenCalled();
    expect(f.advance).toHaveBeenCalledWith("IDENTITY_DELETED", 300_000);
  });
  it("does not advance or erase data when identity removal fails", async () => {
    const f = effects();
    f.removeIdentity.mockRejectedValue(new Error("provider unavailable"));
    await expect(runDeletionStep({ phase: "QUEUED", ...f })).rejects.toThrow(
      "provider unavailable",
    );
    expect(f.advance).not.toHaveBeenCalled();
    expect(f.removeGameData).not.toHaveBeenCalled();
  });
  it("keeps a failed cleanup retryable without calling identity removal again", async () => {
    const f = effects();
    f.removeGameData.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(
      runDeletionStep({ phase: "IDENTITY_DELETED", ...f }),
    ).rejects.toThrow();
    expect(f.advance).not.toHaveBeenCalled();
    await runDeletionStep({ phase: "IDENTITY_DELETED", ...f });
    expect(f.removeIdentity).not.toHaveBeenCalled();
    expect(f.advance).toHaveBeenCalledWith("COMPLETE", 0);
  });
  it("does nothing for a completed request", async () => {
    const f = effects();
    await runDeletionStep({ phase: "COMPLETE", ...f });
    expect(f.removeIdentity).not.toHaveBeenCalled();
    expect(f.removeGameData).not.toHaveBeenCalled();
    expect(f.advance).not.toHaveBeenCalled();
  });
});
