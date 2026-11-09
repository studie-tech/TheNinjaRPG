import { afterEach, describe, expect, it, vi } from "bun:test";
import { fitContent } from "@/libs/native/viewport";
import { installCapacitor, removeCapacitor } from "../../setup/native";

afterEach(removeCapacitor);

describe("Android native viewport", () => {
  it.each([false, true])(
    "fits content and keeps system-bar contrast in dark mode %s",
    async (darkMode) => {
      const setOverlaysWebView = vi.fn().mockResolvedValue(undefined);
      const setBackgroundColor = vi.fn().mockResolvedValue(undefined);
      const setStyle = vi.fn().mockResolvedValue(undefined);
      installCapacitor(
        { StatusBar: { setOverlaysWebView, setBackgroundColor, setStyle } },
        "android",
      );
      await fitContent(darkMode);
      expect(setOverlaysWebView).toHaveBeenCalledWith({ overlay: false });
      expect(setBackgroundColor).toHaveBeenCalledWith({
        color: darkMode ? "#000000" : "#ffffff",
      });
      expect(setStyle).toHaveBeenCalledWith({ style: darkMode ? "DARK" : "LIGHT" });
    },
  );
  it.each(["ios", "web"])("does not alter %s system bars", async (platform) => {
    const setOverlaysWebView = vi.fn();
    installCapacitor({ StatusBar: { setOverlaysWebView } }, platform);
    await fitContent();
    expect(setOverlaysWebView).not.toHaveBeenCalled();
  });
  it("keeps the page usable without a bridge or with an unavailable plugin", async () => {
    removeCapacitor();
    await expect(fitContent()).resolves.toBeUndefined();
    installCapacitor({}, "android");
    await expect(fitContent()).resolves.toBeUndefined();
    installCapacitor(
      {
        StatusBar: {
          setOverlaysWebView: async () => {
            throw new Error("unavailable");
          },
        },
      },
      "android",
    );
    await expect(fitContent()).resolves.toBeUndefined();
  });
});
