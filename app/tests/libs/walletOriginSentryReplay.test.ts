import { describe, expect, it } from "bun:test";
import {
  chromeStack,
  firefoxStack,
  replay,
  replayException,
} from "../setup/sentryReplay";

const own = "https://www.theninja-rpg.com/_next/static/chunks/app-1a2b.js";
const vendor = "https://cdn.example.com/widget.js";
const walletScripts = [
  "chrome-extension://abcdef/inpage.js",
  "app:///scripts/inpage.js",
  "app:///injected/injected.js",
];

const fromEach = async (name: string, message: string, urls: string[]) => {
  const results: (boolean | undefined)[] = [];
  for (const url of urls) {
    for (const stack of [chromeStack, firefoxStack]) {
      results.push(await replay(name, message, stack(name, message, url)));
    }
  }
  return results;
};

describe("wallet extension Sentry filter", () => {
  it.each([
    ["a wallet connection failure", "Error", "Failed to connect to MetaMask"],
    ["a missing provider method", "TypeError", "setExternalProvider is not a function"],
    [
      "a proxy trap",
      "TypeError",
      "'set' on proxy: trap returned falsish for property 'tronlinkParams'",
    ],
    ["a property redefinition", "TypeError", "Cannot redefine property: request"],
    [
      "an unrelated failure",
      "TypeError",
      "Cannot read properties of undefined (reading 'x')",
    ],
  ])("drops %s raised in a wallet's injected script", async (_label, name, message) => {
    expect(await fromEach(name, message, walletScripts)).toEqual(Array(6).fill(true));
  });

  it.each(["ethereum", "tronWeb", "tronLink", "scatter", "walletRouter"])(
    "drops a redefinition of the %s wallet global from any script",
    async (property) => {
      const message = `Cannot redefine property: ${property}`;
      expect(await fromEach("TypeError", message, [own, vendor])).toEqual(
        Array(4).fill(true),
      );
    },
  );

  it.each([
    ["a wallet connection failure", "Error", "Failed to connect to MetaMask"],
    [
      "a proxy trap",
      "TypeError",
      "'set' on proxy: trap returned falsish for property 'x'",
    ],
    ["a property redefinition", "TypeError", "Cannot redefine property: request"],
  ])("reports %s from our own code", async (_label, name, message) => {
    expect(await fromEach(name, message, [own])).toEqual([false, false]);
  });

  it("drops a wallet's plain-object rejection and its rewrapped message", async () => {
    expect(
      await replayException({
        code: 4001,
        message: "User rejected the wallet request",
      }),
    ).toBe(true);
    expect(
      await replayException({ message: "wallet must has at least one account" }),
    ).toBe(true);
    expect(
      await replay(
        "Error",
        "wallet must has at least one account",
        chromeStack("Error", "x", own),
      ),
    ).toBe(true);
    expect(
      await replayException({ code: 4001, message: "User rejected the request" }),
    ).toBe(false);
  });
});

describe("invalid origin Sentry filter", () => {
  it("drops an invalid origin error without a stack or from a third-party script", async () => {
    expect(await replay("Error", "Invalid origin", "Error: Invalid origin")).toBe(true);
    expect(await fromEach("Error", "invalid origin for request", [vendor])).toEqual([
      true,
      true,
    ]);
  });

  it("reports an invalid origin error from our own code", async () => {
    expect(await fromEach("Error", "Invalid origin", [own])).toEqual([false, false]);
  });
});
