import { describe, expect, it } from "bun:test";
import { chromeStack, firefoxStack, replay } from "../setup/sentryReplay";

const own = "https://www.theninja-rpg.com/_next/static/chunks/app-1a2b.js";
const clerkScript =
  "https://clerk.theninja-rpg.com/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
const lookalikeScript = "https://cdn.example.net/vendor/@clerk/clerk.browser.js";
const fapi = "https://clerk.theninja-rpg.com/v1/client";
const proxiedScript =
  "https://www.theninja-rpg.com/__clerk/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
const proxiedFapi = "https://www.theninja-rpg.com/__clerk/v1/client";

const clerkNetworkError = (url: string, cause: string) =>
  `ClerkJS: Network error at "${url}" - TypeError: ${cause}. Please try again.`;

/** Replay through ignoreErrors and beforeSend from a script, in both stack formats. */
const fromScript = async (name: string, message: string, url: string) => [
  await replay(name, message, chromeStack(name, message, url), {
    withIgnoreErrors: true,
  }),
  await replay(name, message, firefoxStack(name, message, url), {
    withIgnoreErrors: true,
  }),
];

describe("network failure Sentry filter", () => {
  it.each(["Failed to fetch", "network error"])(
    "drops a %s failure raised in our own code or without a stack",
    async (message) => {
      expect(await fromScript("TypeError", message, own)).toEqual([true, true]);
      expect(
        await replay("TypeError", message, `TypeError: ${message}`, {
          withIgnoreErrors: true,
        }),
      ).toBe(true);
    },
  );

  it.each([
    [
      "token refresh",
      `${fapi}/sessions/sess_test/tokens?__clerk_api_version=2025-11-10`,
    ],
    ["sign-in", `${fapi}/sign_ins?__clerk_api_version=2025-11-10`],
    ["preview sign-in", "https://example-app.clerk.accounts.dev/v1/client/sign_ins"],
    ["proxied sign-in", `${proxiedFapi}/sign_ins?__clerk_api_version=2025-11-10`],
  ])("reports a failed Clerk %s request", async (_label, url) => {
    for (const cause of ["Failed to fetch", "network error"]) {
      const message = clerkNetworkError(url, cause);
      expect(await fromScript("Error", message, clerkScript)).toEqual([false, false]);
      expect(await fromScript("Error", message, own)).toEqual([false, false]);
    }
  });

  it.each(["Failed to fetch", "network error"])(
    "reports a %s failure raised in the Clerk script",
    async (message) => {
      for (const script of [clerkScript, proxiedScript]) {
        expect(await fromScript("TypeError", message, script)).toEqual([false, false]);
      }
    },
  );

  it("drops a fetch failure that only names a lookalike Clerk host or script", async () => {
    const message = clerkNetworkError(
      "https://clerk.theninja-rpg.com.example.net/v1/client/sign_ins",
      "Failed to fetch",
    );
    expect(await fromScript("Error", message, own)).toEqual([true, true]);
    expect(await fromScript("TypeError", "Failed to fetch", lookalikeScript)).toEqual([
      true,
      true,
    ]);
    const ownNonClerk = clerkNetworkError(
      "https://www.theninja-rpg.com/api/trpc/profile.getUser",
      "Failed to fetch",
    );
    expect(await fromScript("Error", ownNonClerk, own)).toEqual([true, true]);
  });

  it("keeps dropping a failed Clerk session touch", async () => {
    const message = clerkNetworkError(
      `${fapi}/sessions/sess_test/touch`,
      "Failed to fetch",
    );
    expect(await fromScript("Error", message, clerkScript)).toEqual([true, true]);
  });
});
