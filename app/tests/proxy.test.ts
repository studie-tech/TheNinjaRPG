import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { expect, test } from "vitest";
import { config } from "../src/proxy";

const doesProxyMatch = (url: string) =>
  unstable_doesMiddlewareMatch({
    config,
    nextConfig: {},
    url,
  });

test.each([
  "/",
  "/api/trpc/item.splitStack",
  "/forums/showthread.php",
  "/wp/xmlrpc.php",
  "/images/signatures/missing.gif",
  "/apple-touch-icon.png",
  "/users/ipsearch/example.com",
])("proxy supplies Clerk context to %s", (url) => {
  expect(doesProxyMatch(url)).toBe(true);
});

test.each([
  "/_next/static/chunks/app.js",
  "/_next/image",
  "/static/logo.png",
])("proxy excludes framework/static path %s", (url) => {
  expect(doesProxyMatch(url)).toBe(false);
});
