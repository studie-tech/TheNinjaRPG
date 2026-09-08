import { describe, expect, it, vi } from "vitest";
import { retryRejectedOnce } from "@/server/utils/push/authRetry";

interface Attempt {
  token: string;
  authRejected?: boolean;
}

describe("retryRejectedOnce", () => {
  it("refreshes one subset and preserves result order", async () => {
    const retry = vi.fn(
      async (indexes: number[]): Promise<Attempt[]> =>
        indexes.map((index) => ({ token: `retried-${index}` })),
    );
    const results: Attempt[] = [
      { token: "sent" },
      { token: "old-a", authRejected: true },
      { token: "expired" },
      { token: "old-b", authRejected: true },
    ];

    await retryRejectedOnce(results, (result) => result.authRejected === true, retry);

    expect(retry).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledWith([1, 3]);
    expect(results.map((result) => result.token)).toEqual([
      "sent",
      "retried-1",
      "expired",
      "retried-3",
    ]);
  });

  it("keeps the retryable first attempts when credential refresh fails", async () => {
    const results: Attempt[] = [{ token: "old", authRejected: true }];
    await retryRejectedOnce(results, () => true, async () => {
      throw new Error("refresh failed");
    });
    expect(results).toEqual([{ token: "old", authRejected: true }]);
  });
});
