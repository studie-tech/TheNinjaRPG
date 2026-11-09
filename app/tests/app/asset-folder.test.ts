import { describe, expect, it } from "bun:test";
import FolderPage from "@/app/[shell]/manual/asset/[folder]/page";

describe("bookmarked asset folder redirects", () => {
  it.each([
    ["Forest", "Forest"],
    ["QA%20Folder%25", "QA+Folder%25"],
    ["A%2520B", "A%2520B"],
    ["%E9%9B%AA", "%E9%9B%AA"],
  ])("decodes the framework parameter once: %s", async (folder, query) => {
    await expect(
      FolderPage({ params: Promise.resolve({ folder }) }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining(`/manual/asset?folder=${query};`),
    });
  });
});
