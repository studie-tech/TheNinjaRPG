import { afterEach, describe, expect, it, vi } from "bun:test";
import { createTavernUploadGuard } from "@/server/utils/tavernUploads";

const env = process.env as Record<string, string | undefined>;
const originalEnvironment = env.NODE_ENV;
afterEach(() => { if (originalEnvironment === undefined) delete env.NODE_ENV; else env.NODE_ENV = originalEnvironment; vi.restoreAllMocks(); });

describe("tavern image upload allowance", () => {
  it.each([true, false])("returns the account-specific allowance (%s)", async (success) => {
    const limit = vi.fn(async () => ({ success }));
    expect(await createTavernUploadGuard(limit)("writer")).toBe(success);
    expect(limit).toHaveBeenCalledWith("writer");
  });

  it("rejects an SDK timeout even when the SDK marks it successful", async () => {
    env.NODE_ENV = "production";
    await expect(createTavernUploadGuard(async () => ({ success: true, reason: "timeout" }))("writer")).rejects.toThrow("Unable to verify");
  });

  it("rejects an unavailable production backend", async () => {
    env.NODE_ENV = "production";
    await expect(createTavernUploadGuard(async () => { throw new Error("Redis unavailable"); })("writer")).rejects.toThrow("Redis unavailable");
  });

  it.each(["timeout", "unavailable"])("keeps local development usable when Redis is %s", async (reason) => {
    env.NODE_ENV = "development";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const limit = async () => {
      if (reason === "unavailable") throw new Error("Redis unavailable");
      return { success: true, reason: "timeout" };
    };
    expect(await createTavernUploadGuard(limit)("writer")).toBe(true);
  });
});
