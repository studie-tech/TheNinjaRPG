import { describe, expect, it } from "bun:test";
import { GET } from "@/app/.well-known/apple-app-site-association/route";
import { env } from "@/env/server.mjs";
import { browserAuthContinuation } from "@/libs/native/deepLink";

describe("browser-owned native authentication", () => {
  it("excludes browser handoffs before the iOS wildcard while retaining game links", async () => {
    const saved = {
      APNS_TEAM_ID: env.APNS_TEAM_ID,
      APNS_BUNDLE_ID: env.APNS_BUNDLE_ID,
    };
    Object.assign(env, { APNS_TEAM_ID: "TESTTEAM", APNS_BUNDLE_ID: "example.test" });
    try {
      const response = GET();
      expect(response.status).toBe(200);
      const result = await response.json();
      const components = result.applinks.details[0].components as Array<{
        "/": string;
        exclude?: boolean;
      }>;
      const firstMatch = (path: string) =>
        components.find((rule) =>
          rule["/"].endsWith("*")
            ? path.startsWith(rule["/"].slice(0, -1))
            : path === rule["/"],
        );
      expect(firstMatch("/native-sign-in")?.exclude).toBe(true);
      expect(firstMatch("/native-sign-in/")?.exclude).toBe(true);
      expect(firstMatch("/profile")?.exclude).not.toBe(true);
      expect(firstMatch("/settings/device")?.exclude).not.toBe(true);
      expect(result.webcredentials.apps).toEqual(["TESTTEAM.example.test"]);
    } finally {
      Object.assign(env, saved);
    }
  });

  it("only reopens an exact-origin handoff for the single current flow", () => {
    const origin = "https://www.theninja-rpg.com";
    const flow = "a".repeat(43);
    const url = `${origin}/native-sign-in?flow=${flow}&step=callback`;
    expect(browserAuthContinuation(url, origin, flow)).toBe(url);
    for (const invalid of [
      `https://attacker.example/native-sign-in?flow=${flow}`,
      `https://owner@www.theninja-rpg.com/native-sign-in?flow=${flow}`,
      `https://www.theninja-rpg.com:8443/native-sign-in?flow=${flow}`,
      `${origin}/native-sign-in/other?flow=${flow}`,
      `${origin}/native-sign-in?flow=old`,
      `${origin}/native-sign-in?flow=${flow}&flow=${flow}`,
    ])
      expect(browserAuthContinuation(invalid, origin, flow)).toBeNull();
  });
});
