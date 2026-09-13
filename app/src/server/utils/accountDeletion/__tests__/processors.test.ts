import * as uploadthing from "uploadthing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetServerModuleStubs,
  stubDatabase,
} from "../../../../../tests/setup/serverModules";
import { removeAccountProcessorData } from "../processors";

const originalEnv = { ...process.env };
const findMany = vi.fn();
const deletion = vi.fn();
beforeEach(() => {
  deletion.mockReset();
  vi.spyOn(uploadthing, "UTApi").mockImplementation(
    () => ({ deleteFiles: deletion }) as unknown as uploadthing.UTApi,
  );
  vi.spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected network access"),
  );
  process.env.NEXT_PUBLIC_REVENUECAT_IOS_KEY = "";
  process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_KEY = "";
  stubDatabase({ query: { userUpload: { findMany } } });
});
afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  resetServerModuleStubs();
});

describe("owned upload cleanup", () => {
  it("batches the owner's uploads by key type", async () => {
    findMany.mockResolvedValue(
      ["a", "b", "abcdefghijklmnopqrstu.png"].map((key) => ({
        imageUrl: `https://ui0arpl8sm.ufs.sh/f/${key}`,
      })),
    );
    deletion.mockResolvedValue({ success: true, deletedCount: 1 });
    await removeAccountProcessorData("owner");
    expect(deletion).toHaveBeenCalledTimes(2);
    expect(deletion).toHaveBeenCalledWith(["a", "b"], { keyType: "fileKey" });
    expect(deletion).toHaveBeenCalledWith(["abcdefghijklmnopqrstu.png"], {
      keyType: "customId",
    });
  });
  it("keeps failed batches retryable", async () => {
    findMany.mockResolvedValue([{ imageUrl: "https://ui0arpl8sm.ufs.sh/f/a" }]);
    deletion.mockResolvedValue({
      success: false,
      deletedCount: 0,
    });
    await expect(removeAccountProcessorData("owner")).rejects.toThrow(
      "Owned upload deletion failed",
    );
  });
  it("does not delete any batch when an owned URL cannot be safely mapped", async () => {
    findMany.mockResolvedValue([{ imageUrl: "https://other.example/f/a" }]);
    await expect(removeAccountProcessorData("owner")).rejects.toThrow(
      "manual storage cleanup",
    );
    expect(deletion).not.toHaveBeenCalled();
  });
});
