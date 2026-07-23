import { spawnSync } from "node:child_process";
import { expect, test } from "vitest";

const evaluateProxyMatches = (urls: string[]) => {
  const script = `
    import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
    import { config } from "./src/proxy.ts";
    const urls = JSON.parse(process.argv[1]);
    process.stdout.write(JSON.stringify(
      urls.map((url) => unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url,
      })),
    ));
  `;
  const result = spawnSync("bun", ["-e", script, JSON.stringify(urls)], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Failed to evaluate proxy matcher");
  }
  return JSON.parse(result.stdout) as boolean[];
};

const includedPaths = [
  "/",
  "/api/trpc/item.splitStack",
  "/forums/showthread.php",
  "/wp/xmlrpc.php",
  "/images/signatures/missing.gif",
  "/apple-touch-icon.png",
  "/users/ipsearch/example.com",
  "/static-settings",
  "/_next-tools",
];
const excludedPaths = [
  "/_next",
  "/_next/static/chunks/app.js",
  "/_next/image",
  "/static",
  "/static/logo.png",
];

const includedResults = evaluateProxyMatches(includedPaths);
const excludedResults = evaluateProxyMatches(excludedPaths);

test.each(includedPaths.map((url, index) => [url, includedResults[index]]))(
  "proxy supplies Clerk context to %s",
  (_url, matches) => {
    expect(matches).toBe(true);
  },
);

test.each(excludedPaths.map((url, index) => [url, excludedResults[index]]))(
  "proxy excludes framework/static path %s",
  (_url, matches) => {
    expect(matches).toBe(false);
  },
);
