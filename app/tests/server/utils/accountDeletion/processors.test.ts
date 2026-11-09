import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as uploadthing from "uploadthing/server";
import { resetServerModuleStubs, stubDatabase } from "../../../setup/serverModules";
import { removeAccountProcessorData } from "@/server/utils/accountDeletion/processors";

const originalEnv = { ...process.env };
const findMany = vi.fn();
const deletion = vi.fn();
beforeEach(() => {
  deletion.mockReset();
  vi.spyOn(
    uploadthing as unknown as { UTApi: () => uploadthing.UTApi },
    "UTApi",
  ).mockImplementation(
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
    const customIds = ["", "preview-", "pet-", "content-"].map(
      (prefix) => `${prefix}abcdefghijklmnopqrstu.png`,
    );
    const fileKeys = [
      "a",
      "b",
      "pet-raw-file-key.png",
      "other-abcdefghijklmnopqrstu.png",
    ];
    findMany.mockResolvedValue(
      [...fileKeys, ...customIds].map((key, index) => ({
        imageUrl: `https://${index % 2 ? "uploadthing.b-cdn.net" : "ui0arpl8sm.ufs.sh"}/f/${key}`,
      })),
    );
    deletion.mockResolvedValue({ success: true, deletedCount: 1 });
    await removeAccountProcessorData("owner");
    expect(deletion).toHaveBeenCalledTimes(2);
    expect(deletion).toHaveBeenCalledWith(fileKeys, { keyType: "fileKey" });
    expect(deletion).toHaveBeenCalledWith(customIds, {
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
  it.each([
    "https://other.example/f/a",
    "https://ui0arpl8sm.ufs.sh.other.example/f/a",
    "http://ui0arpl8sm.ufs.sh/f/a",
    "https://ui0arpl8sm.ufs.sh/other/a",
    "https://ui0arpl8sm.ufs.sh/f/a/extra",
    "https://ui0arpl8sm.ufs.sh/f/a%2Fextra",
  ])(
    "does not delete any batch when an owned URL cannot be safely mapped: %s",
    async (imageUrl) => {
      findMany.mockResolvedValue([{ imageUrl }]);
      await expect(removeAccountProcessorData("owner")).rejects.toThrow(
        "manual storage cleanup",
      );
      expect(deletion).not.toHaveBeenCalled();
    },
  );
});
