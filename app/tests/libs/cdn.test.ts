import { describe, expect, it } from "vitest";
import { cdnOrigin, contentSecurityPolicy } from "@/libs/cdn.mjs";

describe("cdnOrigin", () => {
  it("is used only on production, where the zone's origin is", () => {
    const cdnUrl = "https://tnrprod.b-cdn.net";
    expect(cdnOrigin({ cdnUrl, vercelEnv: "production" })).toBe(cdnUrl);
    // A preview or local build asking the zone for its own hashed chunks would be
    // served production's 404, so those keep serving their assets themselves.
    expect(cdnOrigin({ cdnUrl, vercelEnv: "preview" })).toBeUndefined();
    expect(cdnOrigin({ cdnUrl, vercelEnv: undefined })).toBeUndefined();
  });

  it("is off until a zone is configured, and tolerates a trailing slash", () => {
    expect(cdnOrigin({ cdnUrl: undefined, vercelEnv: "production" })).toBeUndefined();
    expect(cdnOrigin({ cdnUrl: "", vercelEnv: "production" })).toBeUndefined();
    expect(cdnOrigin({ cdnUrl: "https://x.b-cdn.net/", vercelEnv: "production" })).toBe(
      "https://x.b-cdn.net",
    );
  });
});

describe("contentSecurityPolicy", () => {
  const directive = (csp: string, name: string) =>
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? "";

  it("names the zone everywhere the app would otherwise only allow itself", () => {
    const csp = contentSecurityPolicy("https://tnrprod.b-cdn.net");
    for (const name of ["script-src", "style-src", "font-src", "worker-src"]) {
      expect(directive(csp, name)).toContain("https://tnrprod.b-cdn.net");
    }
  });

  it("is unchanged when no zone is configured", () => {
    const csp = contentSecurityPolicy(undefined);
    // media-src names uploadthing's zone already; nothing else gains a host.
    expect(csp).not.toContain("tnrprod");
    expect(directive(csp, "font-src")).toBe("font-src 'self'");
    expect(directive(csp, "script-src")).toContain("'self'");
    expect(directive(csp, "font-src")).toBe("font-src 'self'");
  });

  it("leaves the fallback alone, which is what covers the types it does not name", () => {
    // manifest-src and object-src fall back to default-src: nothing under public/ is
    // served from the zone, so they must keep naming the app alone.
    for (const origin of [undefined, "https://tnrprod.b-cdn.net"]) {
      expect(directive(contentSecurityPolicy(origin), "default-src")).toBe(
        "default-src 'self'",
      );
    }
  });

  it("is a single header line", () => {
    expect(contentSecurityPolicy("https://x.b-cdn.net")).not.toContain("\n");
  });
});

describe("CDN_URL validation", () => {
  const parse = async (value: string | undefined) => {
    const { serverSchema } = await import("@/env/schema.mjs");
    const result = serverSchema.shape.CDN_URL.safeParse(value);
    return result.success ? null : result.error;
  };

  it("allows an unset or empty CDN origin", async () => {
    expect(await parse(undefined)).toBeNull();
    expect(await parse("")).toBeNull();
  });

  it("takes a bare https origin", async () => {
    expect(await parse("https://tnrprod.b-cdn.net")).toBeNull();
  });

  it("refuses what would otherwise become a script-src host", async () => {
    // The value lands in the CSP and in assetPrefix: plaintext would make the cached
    // bundle rewritable in transit, and a path would break asset URLs.
    expect(await parse("http://tnrprod.b-cdn.net")).not.toBeNull();
    expect(await parse("javascript:alert(1)")).not.toBeNull();
    expect(await parse("https://tnrprod.b-cdn.net/assets")).not.toBeNull();
    expect(await parse("not-a-url")).not.toBeNull();
  });
});
