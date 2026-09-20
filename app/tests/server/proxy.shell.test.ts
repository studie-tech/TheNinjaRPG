import { describe, expect, it } from "vitest";
import { isUnshelledPath } from "../../src/proxy";

describe("isUnshelledPath", () => {
  // The matcher admits these so Clerk can attach its context; rewriting them to a
  // shell variant turned every tRPC call into a 404 page, which the client parsed as an
  // error and sent signed-in visitors to /500.
  it.each([
    "/api/trpc/profile.getUser",
    "/api/trpc/profile.getUser,home.getUserHome",
    "/api/chat/support",
    "/api/uploadthing",
    "/api",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource/resource",
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
