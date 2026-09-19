import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { landingCacheUrl } from "../../src/proxy";

const request = (url: string, init: { ua?: string; cookies?: Record<string, string> } = {}) => {
  const cookie = Object.entries(init.cookies ?? {})
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  return new NextRequest(url, {
    headers: {
      "user-agent": init.ua ?? "Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36",
      ...(cookie ? { cookie } : {}),
    },
  });
};

describe("landingCacheUrl", () => {
  // The signed-out homepage is a client-hydrated shell whose server render depends only
  // on the layout variant, yet every visit ran a full render on a function -- 1.2-1.6s
  // TTFB at P75, over 3s far from the region. The proxy rewrites those visits to a URL
  // keyed by variant so the edge can cache one render per variant. What must never happen
  // is a visitor receiving a copy rendered under different per-request conditions than
  // their own, so the cases that opt out matter as much as the ones that opt in.
  it("keys the rewrite on the layout variant and nothing else", () => {
    expect(landingCacheUrl(request("https://www.theninja-rpg.com/"), "pixel")?.search).toBe(
      "?landing=pixel",
    );
    expect(
      landingCacheUrl(request("https://www.theninja-rpg.com/"), "default")?.search,
    ).toBe("?landing=default");
  });

  it("drops referral and campaign parameters from the cache key", () => {
    // They are read on the client from the browser URL, which a rewrite leaves alone;
    // keeping them here would give every shared link its own cold cache entry.
    const url = landingCacheUrl(
      request("https://www.theninja-rpg.com/?ref=xywerty&utm_source=reddit"),
      "default",
    );
    expect(url?.search).toBe("?landing=default");
  });

  it("opts a native shell out, since its Clerk proxy setting is per request", () => {
    const native = request("https://www.theninja-rpg.com/", {
      ua: "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 TNR-Native/1.2.0 (ios)",
    });
    expect(landingCacheUrl(native, "pixel")).toBeNull();
  });

  it("opts a non-default font scale out, since it is inlined into the document root", () => {
    const scaled = request("https://www.theninja-rpg.com/", {
      cookies: { tnr_font_scale: "1.3" },
    });
    expect(landingCacheUrl(scaled, "pixel")).toBeNull();
    const standard = request("https://www.theninja-rpg.com/", {
      cookies: { tnr_font_scale: "1" },
    });
    expect(landingCacheUrl(standard, "pixel")?.search).toBe("?landing=pixel");
  });
});
