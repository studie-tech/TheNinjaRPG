import { describe, expect, it } from "bun:test";
import { toInternalPath, toSafePath } from "@/libs/native/deepLink";

describe("toInternalPath", () => {
  it("accepts the site and its subdomains", () => {
    expect(toInternalPath("https://www.theninja-rpg.com/battlearena")).toBe(
      "/battlearena",
    );
    expect(toInternalPath("https://theninja-rpg.com/profile?tab=nindo#top")).toBe(
      "/profile?tab=nindo#top",
    );
  });

  it("rejects a host that merely ends with ours", () => {
    // The whole point: endsWith would open eviltheninja-rpg.com inside the app, which is
    // an attacker-controlled page rendered as if it were the game.
    expect(toInternalPath("https://eviltheninja-rpg.com/steal")).toBeNull();
    expect(toInternalPath("https://theninja-rpg.com.attacker.dev/steal")).toBeNull();
  });

  it("rejects non-https and malformed links", () => {
    expect(toInternalPath("http://www.theninja-rpg.com/profile")).toBeNull();
    expect(toInternalPath("javascript:alert(1)")).toBeNull();
    expect(toInternalPath("not a url")).toBeNull();
  });

  it("cannot be talked into a protocol-relative path that leaves the app", () => {
    // Handed to the router as-is, "//evil.com/x" navigates to https://evil.com/x.
    expect(toInternalPath("https://www.theninja-rpg.com//evil.com/x")).toBe(
      "/evil.com/x",
    );
    expect(toInternalPath("https://www.theninja-rpg.com/\\evil.com/x")).toBe(
      "/evil.com/x",
    );
    expect(toSafePath("//evil.com/x")).toBe("/evil.com/x");
    expect(toSafePath("/battlearena")).toBe("/battlearena");
    expect(toSafePath("https://evil.com/x")).toBeNull();
    expect(toSafePath(undefined)).toBeNull();
  });
});
