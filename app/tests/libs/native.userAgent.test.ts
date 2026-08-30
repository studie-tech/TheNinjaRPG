import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isNativeUserAgent,
  isOutdatedNativeClient,
  parseNativeUserAgent,
} from "@/libs/native/userAgent";

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Mobile/15E148 TNR-Native/1.2.3 (ios)";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/126.0.0.0 Mobile Safari/537.36 TNR-Native/1.2 (android)";
const SAFARI_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

describe("parseNativeUserAgent", () => {
  it("reads the version and platform out of the shell marker", () => {
    expect(parseNativeUserAgent(IOS_UA)).toEqual({ version: "1.2.3", platform: "ios" });
    expect(parseNativeUserAgent(ANDROID_UA)).toEqual({
      version: "1.2",
      platform: "android",
    });
  });

  it("returns null for ordinary browsers and for missing values", () => {
    expect(parseNativeUserAgent(SAFARI_UA)).toBeNull();
    expect(parseNativeUserAgent(undefined)).toBeNull();
    expect(parseNativeUserAgent(null)).toBeNull();
    expect(parseNativeUserAgent("")).toBeNull();
  });

  it("rejects a marker without a recognised platform rather than guessing", () => {
    expect(parseNativeUserAgent("TNR-Native/1.0 (windows)")).toBeNull();
    expect(parseNativeUserAgent("TNR-Native/1.0")).toBeNull();
  });

  it("drives isNativeUserAgent", () => {
    expect(isNativeUserAgent(ANDROID_UA)).toBe(true);
    expect(isNativeUserAgent(SAFARI_UA)).toBe(false);
  });
});

describe("compareVersions", () => {
  it("orders by numeric segment, not lexically", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.9.0", "1.10.0")).toBeLessThan(0);
  });

  it("treats missing trailing segments as zero", () => {
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.1", "1.2")).toBeGreaterThan(0);
  });

  it("does not throw on malformed input", () => {
    expect(compareVersions("", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("x.y", "0.0")).toBe(0);
  });
});

describe("isOutdatedNativeClient", () => {
  it("only ever flags native clients", () => {
    expect(isOutdatedNativeClient(null, "2.0.0")).toBe(false);
  });

  it("compares against the minimum supported build", () => {
    const client = parseNativeUserAgent(IOS_UA);
    expect(isOutdatedNativeClient(client, "2.0.0")).toBe(true);
    expect(isOutdatedNativeClient(client, "1.2.3")).toBe(false);
    expect(isOutdatedNativeClient(client, "1.0.0")).toBe(false);
  });
});

describe("toInternalPath", () => {
  it("accepts the site and its subdomains", async () => {
    const { toInternalPath } = await import("@/libs/native/deepLink");
    expect(toInternalPath("https://www.theninja-rpg.com/battlearena")).toBe(
      "/battlearena",
    );
    expect(toInternalPath("https://theninja-rpg.com/profile?tab=nindo#top")).toBe(
      "/profile?tab=nindo#top",
    );
  });

  it("rejects a host that merely ends with ours", async () => {
    // The whole point: endsWith would open eviltheninja-rpg.com inside the app, which is
    // an attacker-controlled page rendered as if it were the game.
    const { toInternalPath } = await import("@/libs/native/deepLink");
    expect(toInternalPath("https://eviltheninja-rpg.com/steal")).toBeNull();
    expect(toInternalPath("https://theninja-rpg.com.attacker.dev/steal")).toBeNull();
  });

  it("rejects non-https and malformed links", async () => {
    const { toInternalPath } = await import("@/libs/native/deepLink");
    expect(toInternalPath("http://www.theninja-rpg.com/profile")).toBeNull();
    expect(toInternalPath("javascript:alert(1)")).toBeNull();
    expect(toInternalPath("not a url")).toBeNull();
  });
});
