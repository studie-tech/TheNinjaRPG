import { describe, expect, it } from "vitest";
import { isIOSInstallDevice } from "@/libs/pwaInstall";

const browser = (
  userAgent: string,
  platform = "",
  maxTouchPoints = 0,
): Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints"> => ({
  userAgent,
  platform,
  maxTouchPoints,
});

describe("isIOSInstallDevice", () => {
  it("recognizes an iPhone user agent", () => {
    expect(isIOSInstallDevice(browser("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"))).toBe(
      true,
    );
  });

  it("recognizes an iPad using desktop-class Safari", () => {
    expect(
      isIOSInstallDevice(
        browser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 5),
      ),
    ).toBe(true);
  });

  it("does not mistake a touchless Mac for an iPad", () => {
    expect(
      isIOSInstallDevice(
        browser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", "MacIntel", 0),
      ),
    ).toBe(false);
  });
});
