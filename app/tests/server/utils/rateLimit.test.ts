import { afterEach, describe, expect, it, vi } from "bun:test";
import { strictRateLimit } from "@/server/utils/rateLimit";
import { restoreEnvAfterEach } from "../../setup/env";

const env = process.env as Record<string, string | undefined>;
restoreEnvAfterEach("NODE_ENV");
afterEach(() => {
  vi.restoreAllMocks();
});

describe("strict rate limit", () => {
  it.each([true, false])("returns the allowance (%s)", async (success) => {
    expect(await strictRateLimit("image upload", async () => ({ success }))).toBe(
      success,
    );
  });

  it("rejects an SDK timeout even when the SDK marks it successful", async () => {
    env.NODE_ENV = "production";
    await expect(
      strictRateLimit("image upload", async () => ({
        success: true,
        reason: "timeout",
      })),
    ).rejects.toThrow("Unable to verify image upload allowance. Please try again.");
  });

  it("rejects an unavailable production backend", async () => {
    env.NODE_ENV = "production";
    await expect(
      strictRateLimit("image upload", async () => {
        throw new Error("Redis unavailable");
      }),
    ).rejects.toThrow("Redis unavailable");
  });

  it.each(["timeout", "unavailable"])(
    "keeps local development usable when Redis is %s",
    async (reason) => {
      env.NODE_ENV = "development";
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const limit = async () => {
        if (reason === "unavailable") throw new Error("Redis unavailable");
        return { success: true, reason: "timeout" };
      };
      expect(await strictRateLimit("image upload", limit)).toBe(true);
    },
  );
});
