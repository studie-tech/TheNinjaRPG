import { describe, expect, it } from "bun:test";
import { loginRedirectPath } from "@/utils/routing";

describe("loginRedirectPath", () => {
  it("returns to the game page after signing in", () => {
    expect(loginRedirectPath("/travel")).toBe("/login?redirect_url=%2Ftravel");
    expect(loginRedirectPath("/users/abc?tab=jutsu")).toBe(
      `/login?redirect_url=${encodeURIComponent("/users/abc?tab=jutsu")}`,
    );
  });

  it("signs in without a return for entry pages", () => {
    expect(loginRedirectPath("/")).toBe("/login");
    expect(loginRedirectPath("/?ref=abc")).toBe("/login");
    expect(loginRedirectPath("/login")).toBe("/login");
    expect(loginRedirectPath("/signup")).toBe("/login");
  });

  it("never returns to another site", () => {
    expect(loginRedirectPath("//evil.example/x")).toBe("/login");
    expect(loginRedirectPath("/\\evil.example")).toBe("/login");
    expect(loginRedirectPath("https://evil.example/x")).toBe("/login");
  });
});
