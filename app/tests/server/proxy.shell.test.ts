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
    "/__clerk/v1/client",
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
  // Next needs the matcher as literals, so the entry that admits variant paths cannot
  // be generated from SHELL_PARAMS; this keeps the two from drifting apart.
  const variantEntry = config.matcher.find((entry) => entry.includes("(in|out)"));

  it("admits every variant path, so the redirect to the public path always runs", () => {
    expect(variantEntry).toBeDefined();
    const pattern = new RegExp(`^${variantEntry?.replace("/:path*", "(?:/.*)?")}$`);
    for (const param of SHELL_PARAMS) {
      expect(`/${param}/home`).toMatch(pattern);
      expect(`/${param}/manual/asset/x.y`).toMatch(pattern);
    }
    expect("/native-pixel-in/home").not.toMatch(pattern);
  });

  it("treats only a dotted last segment as file-like", () => {
    // /x.php/guide must be rewritten: left alone it matches the shell segment with the
    // file name as its value and renders the page beneath it into a 404.
    const skip = config.matcher[0]?.match(/^\/\(\(\?!(.*)\)\.\*\)$/)?.[1];
    expect(skip).toBeDefined();
    const skipped = (path: string) => new RegExp(`^(?:${skip})`).test(path.slice(1));
    expect(skipped("/foo.png")).toBe(true);
    expect(skipped("/wp-login.php")).toBe(true);
    expect(skipped("/x.php/guide")).toBe(false);
    expect(skipped("/.well-known/apple-app-site-association")).toBe(false);
    expect(skipped("/home")).toBe(false);
    expect(skipped("/api/trpc/x")).toBe(true);
  });
});
