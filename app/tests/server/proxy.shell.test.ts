import { tryToParsePath } from "next/dist/lib/try-to-parse-path";
import { describe, expect, it } from "vitest";
import { SHELL_PARAMS } from "@/libs/shell";
import { config, isUnshelledPath } from "../../src/proxy";

describe("isUnshelledPath", () => {
  // The matcher admits these so Clerk can attach its context; rewriting them to a
  // shell variant turned every tRPC call into a 404 page, which the client parsed as an
  // error and sent signed-in visitors to /500.
  it.each([
    "/api/trpc/profile.getUser",
    "/api/trpc/profile.getUser,home.getUserHome",
    "/api/chat/support",
    "/api/uploadthing",
    "/.well-known/apple-app-site-association",
    "/.well-known/oauth-authorization-server",
    "/opengraph-image",
  ])("lets %s reach its handler untouched", (path) => {
    expect(isUnshelledPath(path)).toBe(true);
  });

  it.each(["/", "/home", "/apis", "/api-docs", "/login", "/username/api", "/forum/1"])(
    "rewrites the page at %s",
    (path) => {
      expect(isUnshelledPath(path)).toBe(false);
    },
  );
});

describe("proxy matcher", () => {
  // Compiled exactly as the build compiles it, so this tests what the middleware sees
  // rather than a hand translation of the matcher syntax.
  const patterns = config.matcher.map((entry) => {
    const { regexStr } = tryToParsePath(entry);
    if (!regexStr) throw new Error(`matcher entry did not compile: ${entry}`);
    return new RegExp(regexStr);
  });
  const admits = (path: string) => patterns.some((pattern) => pattern.test(path));

  it("admits every variant path, so the redirect to the public path always runs", () => {
    // Next needs the matcher as literals, so the entry cannot be generated from
    // SHELL_PARAMS; this keeps the two from drifting apart.
    for (const param of SHELL_PARAMS) {
      expect(admits(`/${param}/home`)).toBe(true);
      expect(admits(`/${param}/manual/asset/x.y`)).toBe(true);
    }
  });

  it.each([
    "/home",
    "/x.php/guide",
    "/.well-known/apple-app-site-association",
    "/username/some.name",
    "/login/factor-one",
    "/api/trpc/profile.getUser",
  ])("admits %s", (path) => {
    // A dotted earlier segment (/x.php/guide) must be rewritten: left alone it would
    // match the shell segment with the file name as its value.
    expect(admits(path)).toBe(true);
  });

  it.each(["/foo.png", "/wp-login.php", "/guide/x.php", "/api/healthcheck", "/_next/static/a.js"])(
    "skips %s, which is served without the middleware",
    (path) => {
      expect(admits(path)).toBe(false);
    },
  );
});
