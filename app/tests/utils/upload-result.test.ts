import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as toast from "@/libs/toast";
import { readUploadResult, showUploadError } from "@/utils/uploadthing";

const showToast = vi.fn();

beforeEach(() => {
  showToast.mockClear();
  vi.spyOn(toast, "showMutationToast").mockImplementation(showToast);
});
afterEach(() => vi.restoreAllMocks());

describe("readUploadResult", () => {
  it("returns an accepted upload's server data silently", () => {
    const serverData = { fileUrl: "https://cdn/image.png", error: undefined };
    expect(readUploadResult([{ serverData }])).toBe(serverData);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("toasts a rejected upload and yields nothing", () => {
    const res = [{ serverData: { fileUrl: "", error: "Image rejected" } }];
    expect(readUploadResult(res)).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith({
      success: false,
      message: "Image rejected",
    });
  });

  it("tolerates a completion without files", () => {
    expect(readUploadResult(undefined)).toBeUndefined();
    expect(readUploadResult<{ error?: string }>([])).toBeUndefined();
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("showUploadError", () => {
  it("toasts the upload failure", () => {
    showUploadError(new Error("Too large"));
    expect(showToast).toHaveBeenCalledWith({ success: false, message: "Too large" });
  });
});
