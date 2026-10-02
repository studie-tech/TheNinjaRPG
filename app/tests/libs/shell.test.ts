import { WALLPAPER_EXPERIMENT, WALLPAPER_VARIANTS } from "@/libs/wallpaperExperiment";
import { describe, expect, it } from "vitest";
import { LAYOUT_PREFERENCE_COOKIE, LEGACY_AB_LAYOUT_COOKIE } from "@/libs/layoutPreference";
import {
  chooseShell,
  parseShellParam,
  publicPathForShellPath,
  SHELL_PARAMS,
  type ShellRequest,
  shellParam,
} from "@/libs/shell";

describe("shell variants", () => {
  it("round-trips every variant through its URL segment", () => {
    for (const client of ["web", "ios", "android"] as const) {
      for (const layout of ["default", "pixel"] as const) {
        for (const signedIn of [false, true]) {
          const variant = { client, layout, signedIn };
          expect(parseShellParam(shellParam(variant))).toEqual(variant);
        }
      }
    }
  });

  it.each(["", "native-pixel-in", "web-pixel-in-x", "WEB-PIXEL-IN"])(
    "rejects %j, which no rewrite ever produces",
    (param) => {
      expect(parseShellParam(param)).toBeNull();
    },
  );

  it("builds every variant once", () => {
    expect(SHELL_PARAMS).toHaveLength(17);
    expect(new Set(SHELL_PARAMS).size).toBe(17);
    expect(SHELL_PARAMS).toContain("web-default-out");
    expect(SHELL_PARAMS).toContain("android-pixel-in");
  });
});

describe("publicPathForShellPath", () => {
  // The variant segment is internal to the rewrite. A request that names one directly
  // must be sent back to the public URL, or the segment leaks into the URL bar and into
  // any link copied from it.
  it.each([
    ["/web-pixel-in/home", "/home"],
    ["/web-default-out", "/"],
    ["/web-default-out/", "/"],
    ["/android-pixel-in/profile/edit", "/profile/edit"],
    ["/ios-default-out/manual/asset/x.y", "/manual/asset/x.y"],
  ])("maps %s to %s", (path, expected) => {
    expect(publicPathForShellPath(path)).toBe(expected);
  });

  it.each([
    ["/web-pixel-in//evil.example", "/evil.example"],
    ["/web-pixel-in/\\evil.example", "/evil.example"],
    ["/web-pixel-in///x", "/x"],
  ])("never produces a redirect that leaves the site: %s -> %s", (path, expected) => {
    expect(publicPathForShellPath(path)).toBe(expected);
  });

  it.each([
    "/home",
    "/",
    "/web-pixel-inside",
    "/users/web-pixel-in",
    "/web-pixel-in-x/home",
    "/WEB-PIXEL-IN/home",
    "/native-pixel-in/home",
  ])("leaves %s alone", (path) => {
    expect(publicPathForShellPath(path)).toBeNull();
  });

  it("covers every variant the build produces", () => {
    for (const param of SHELL_PARAMS) {
      expect(publicPathForShellPath(`/${param}/home`)).toBe("/home");
      expect(publicPathForShellPath(`/${param}`)).toBe("/");
    }
  });
});

describe("chooseShell", () => {
  const CHROME = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/129.0 Safari/537.36";
  const GOOGLEBOT =
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  const request = (
    overrides: Partial<Omit<ShellRequest, "cookies">> & { cookies?: Record<string, string> },
  ): ShellRequest => ({
    userAgent: CHROME,
    pathname: "/home",
    userId: null,
    draw: () => "treatment",
    drawWallpaper: () => "winter",
    ...overrides,
    cookies: new Map(Object.entries(overrides.cookies ?? {})),
  });

  it("gives a first-time visitor on the landing page the default layout", () => {
    const { variant, assigned } = chooseShell(request({ pathname: "/" }));
    expect(assigned).toEqual({ [LEGACY_AB_LAYOUT_COOKIE]: "treatment", [WALLPAPER_EXPERIMENT]: "winter" });
    expect(variant).toEqual({ client: "web", layout: "default", signedIn: false, wallpaper: "winter" });
  });

  it("draws nothing off the landing page, and nothing a visitor already carries", () => {
    expect(chooseShell(request({ pathname: "/home" })).assigned).toEqual({});
    const carried = chooseShell(
      request({ pathname: "/", cookies: { [LEGACY_AB_LAYOUT_COOKIE]: "control", [WALLPAPER_EXPERIMENT]: "spring" } }),
    );
    expect(carried.assigned).toEqual({});
  });

  it("ignores a pixel preference until the visitor is signed in", () => {
    const signedOut = chooseShell(
      request({ pathname: "/", cookies: { [LAYOUT_PREFERENCE_COOKIE]: "pixel" } }),
    );
    expect(signedOut.variant.layout).toBe("default");
    const signedIn = chooseShell(
      request({ userId: "user_1", cookies: { [LAYOUT_PREFERENCE_COOKIE]: "pixel" } }),
    );
    expect(signedIn.variant.layout).toBe("pixel");
  });

  it("gives a signed-in player without a preference the default layout", () => {
    expect(chooseShell(request({ userId: "user_1" })).variant.layout).toBe("default");
  });

  it("reads the signed-in frame from Clerk's client marker, not from the token", () => {
    // A stale token on one RSC fetch must not flip the whole shell and remount it: the
    // marker outlives the token, and it is what the client's own frame decision uses.
    const staleToken = chooseShell(request({ cookies: { __client_uat: "1789800000" } }));
    expect(staleToken.variant.signedIn).toBe(true);
    const verified = chooseShell(request({ userId: "user_1" }));
    expect(verified.variant.signedIn).toBe(true);
    const signedOut = chooseShell(request({ cookies: { __client_uat: "0" } }));
    expect(signedOut.variant.signedIn).toBe(false);
    const multiSession = chooseShell(request({ cookies: { __client_uat_V9abc: "17" } }));
    expect(multiSession.variant.signedIn).toBe(true);
  });

  it("never draws an assignment for a signed-in visitor", () => {
    const { assigned } = chooseShell(request({ pathname: "/", userId: "user_1" }));
    expect(assigned).toEqual({});
  });

  it("pins a crawler to the signed-out default layout whatever it carries", () => {
    const { variant, assigned } = chooseShell(
      request({
        userAgent: GOOGLEBOT,
        pathname: "/",
        cookies: { [LAYOUT_PREFERENCE_COOKIE]: "pixel" },
      }),
    );
    expect(variant).toEqual({ client: "web", layout: "default", signedIn: false });
    expect(assigned).toEqual({});
  });

  it("treats a session-bearing 'bot' as the person it is", () => {
    const { variant } = chooseShell(
      request({
        userAgent: "Mozilla/5.0 (compatible; SomeBot/1.0)",
        cookies: { __client_uat: "1789800000", [LAYOUT_PREFERENCE_COOKIE]: "pixel" },
      }),
    );
    expect(variant).toEqual({ client: "web", layout: "pixel", signedIn: true });
  });

  it("recognises the native shells by platform", () => {
    const ios = chooseShell(
      request({
        userAgent: "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 TNR-Native/1.2.0 (ios)",
      }),
    );
    const android = chooseShell(
      request({ userAgent: "Mozilla/5.0 (Linux; Android 14) TNR-Native/1.2.0 (android)" }),
    );
    expect(ios.variant.client).toBe("ios");
    expect(android.variant.client).toBe("android");
  });
});

 describe("wallpaper shell isolation", () => {
  for (const wallpaper of WALLPAPER_VARIANTS) {
    it(`round trips ${wallpaper} and reuses its assignment off the landing page`, () => {
      const variant = { client: "web" as const, layout: "default" as const, signedIn: false, wallpaper };
      expect(parseShellParam(shellParam(variant))).toEqual(variant);
      expect(publicPathForShellPath(`/${shellParam(variant)}/signup`)).toBe("/signup");
      const choice = chooseShell({ userAgent: "Chrome", userId: null, pathname: "/signup", cookies: new Map([[WALLPAPER_EXPERIMENT, wallpaper]]), draw: () => "control" });
      expect(choice.variant).toEqual(variant);
      expect(choice.assigned).toEqual({});
    });
  }
  it("does not enroll prefetch, native, crawlers or existing sessions", () => {
    const base = { userAgent: "Chrome", userId: null, pathname: "/", cookies: new Map<string, string>(), draw: () => "control" as const, drawWallpaper: () => "winter" as const };
    for (const overrides of [{ isDocument: false }, { userAgent: "Googlebot" }, { userId: "user_1" }, { cookies: new Map([["__client_uat", "17"]]) }, { userAgent: "TNR-Native/1.2.0 (ios)" }]) {
      expect(chooseShell({ ...base, ...overrides }).assigned[WALLPAPER_EXPERIMENT]).toBeUndefined();
    }
  });
  it("replaces an invalid assignment on a document landing visit", () => {
    expect(chooseShell({ userAgent: "Chrome", userId: null, pathname: "/", cookies: new Map([[WALLPAPER_EXPERIMENT, "bogus"]]), draw: () => "control", drawWallpaper: () => "summer" }).variant.wallpaper).toBe("summer");
  });
 });
