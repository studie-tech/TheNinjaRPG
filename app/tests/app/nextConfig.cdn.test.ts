import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { snapshotEnv } from "../setup/env";

/**
 * The zone origin is resolved once in next.config.mjs. This asserts the property its
 * comments claim: everything that names the zone names that same value. The unconfigured
 * case is covered by cdnOrigin's own tests, since the config reads it at module load.
 */
describe("next.config with a pull zone configured", () => {
  const CDN_URL = "https://tnrprod.b-cdn.net/";
  const overrides = {
    SKIP_ENV_VALIDATION: "1",
    CDN_URL,
    VERCEL_ENV: "production",
  };
  let assetPrefix: string | undefined;
  let rules: { source: string; headers: { key: string; value: string }[] }[];
  let redirects: { source: string; destination: string; permanent: boolean }[];

  beforeAll(async () => {
    Object.assign(process.env, overrides);
    const config = (await import("../../next.config.mjs")).default as {
      assetPrefix?: string;
      headers: () => Promise<typeof rules>;
      redirects: () => Promise<typeof redirects>;
    };
    assetPrefix = config.assetPrefix;
    rules = await config.headers();
    redirects = await config.redirects();
  });

  // The whole suite shares one process.
  afterAll(snapshotEnv(...Object.keys(overrides)));

  const headerValue = (source: string, key: string) =>
    rules.find((rule) => rule.source === source)?.headers.find((h) => h.key === key)
      ?.value;

  it("prefixes assets with the zone, normalising the trailing slash", () => {
    expect(assetPrefix).toBe("https://tnrprod.b-cdn.net");
  });

  it("routes legacy registration through the welcome page that captures attribution", () => {
    expect(redirects.find((rule) => rule.source === "/register.php")).toMatchObject({
      destination: "/",
      permanent: true,
    });
  });

  it("names that same origin in the policy the browser enforces", () => {
    expect(headerValue("/:path*", "Content-Security-Policy")).toContain(assetPrefix);
  });

  it("lets the browser use the cross-origin chunks Next marks `crossorigin`", () => {
    expect(headerValue("/_next/static/:path*", "Access-Control-Allow-Origin")).toBe(
      "*",
    );
    expect(headerValue("/_next/static/:path*", "X-Robots-Tag")).toBe("noindex");
  });
});
