import { afterEach, describe, expect, it, vi } from "bun:test";
import { downloadBlob, getScrollBehavior } from "@/utils/dom";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("downloadBlob", () => {
  it("clicks a named anchor, removes it and releases the object URL", () => {
    const blob = new Blob(["data"]);
    const created = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:file");
    const revoked = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const clicked: { href: string; download: string; connected: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({
        href: this.href,
        download: this.download,
        connected: this.isConnected,
      });
    });

    downloadBlob(blob, "stats.csv");

    expect(created).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual([
      { href: "blob:file", download: "stats.csv", connected: true },
    ]);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revoked).toHaveBeenCalledWith("blob:file");
  });
});

describe("getScrollBehavior", () => {
  it.each([
    [true, "auto"],
    [false, "smooth"],
  ] as const)("reduced motion %p scrolls with %s", (matches, behavior) => {
    const matchMedia = vi.fn(() => ({ matches }));
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: matchMedia,
    });
    expect(getScrollBehavior()).toBe(behavior);
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
  });
});
