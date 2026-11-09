import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "bun:test";

const MOBILE_ROOT = join(import.meta.dirname, "../../../mobile");
const PRODUCTION = "https://www.theninja-rpg.com";
const SENTINEL = "// Previous valid entry configuration\n";

function readConfiguration(rawOrigin: string | undefined) {
  const directory = mkdtempSync(join(tmpdir(), "tnr-native-origin-"));
  try {
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "www"));
    for (const file of [
      "package.json",
      "origin.mjs",
      "capacitor.config.ts",
      "scripts/write-config.mjs",
    ]) {
      copyFileSync(join(MOBILE_ROOT, file), join(directory, file));
    }
    writeFileSync(join(directory, "www/config.js"), SENTINEL);
    const env = { ...process.env };
    if (rawOrigin === undefined) delete env.TNR_ORIGIN;
    else env.TNR_ORIGIN = rawOrigin;
    // Separate processes exercise the real module-load environment in each consumer.
    const capacitor = spawnSync(
      "node",
      [
        "--input-type=module",
        "-e",
        `
      import config from "./capacitor.config.ts";
      console.log(JSON.stringify(config.server.allowNavigation));
    `,
      ],
      { cwd: directory, env, encoding: "utf8" },
    );
    const writer = spawnSync("node", ["scripts/write-config.mjs"], {
      cwd: directory,
      env,
      encoding: "utf8",
    });
    return {
      capacitor,
      writer,
      entryConfig: readFileSync(join(directory, "www/config.js"), "utf8"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function loadEntry(
  entryConfig: string,
  { supportsColorMix = true, supportsSelectors = true, userAgent = "Android" } = {},
) {
  const requested: string[] = [];
  const navigated: string[] = [];
  const context = {
    URL,
    AbortController,
    CSS: {
      supports: (property: string) =>
        property === "color" ? supportsColorMix : supportsSelectors,
    },
    navigator: { userAgent },
    document: { getElementById: () => ({ addEventListener() {} }) },
    window: {
      CSS: {},
      TNR_ORIGIN: undefined as string | undefined,
      addEventListener() {},
      location: { replace: (url: string) => navigated.push(url) },
    },
    setTimeout: () => 0,
    clearTimeout() {},
    fetch: (url: string) => {
      requested.push(url);
      return Promise.resolve({ ok: true });
    },
  };
  runInNewContext(entryConfig, context);
  const html = readFileSync(join(MOBILE_ROOT, "www/index.html"), "utf8");
  const script = new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector("script:not([src])")?.textContent;
  if (!script) throw new Error("Bundled entry script is missing");
  runInNewContext(script, context);
  await new Promise<void>((resolve) => setImmediate(resolve));
  return { origin: context.window.TNR_ORIGIN, requested, navigated };
}

describe("native origin configuration", () => {
  it("lets the iOS shell reach login without color-mix while keeping Android's update guard", async () => {
    const entryConfig = `window.TNR_ORIGIN = ${JSON.stringify(PRODUCTION)};`;
    const ios = await loadEntry(entryConfig, {
      supportsColorMix: false,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) TNR-Native/1.0.0 (ios)",
    });
    expect(ios.navigated).toEqual([PRODUCTION]);
    expect(ios.requested).toHaveLength(1);
    const android = await loadEntry(entryConfig, {
      supportsColorMix: false,
      userAgent: "Android TNR-Native/1.0.0 (android)",
    });
    expect(android.navigated).toEqual([]);
    expect(android.requested).toEqual([]);
    const olderIos = await loadEntry(entryConfig, {
      supportsColorMix: false,
      supportsSelectors: false,
      userAgent: "iPhone TNR-Native/1.0.0 (ios)",
    });
    expect(olderIos.navigated).toEqual([]);
    expect(olderIos.requested).toEqual([]);
  });

  for (const rawOrigin of [
    undefined,
    PRODUCTION,
    `${PRODUCTION}/`,
    "https://WWW.THENINJA-RPG.COM:443/",
  ]) {
    it(`keeps production entry and Clerk trust aligned for ${rawOrigin ?? "the default"}`, async () => {
      const { capacitor, writer, entryConfig } = readConfiguration(rawOrigin);
      expect(capacitor.status).toBe(0);
      expect(writer.status).toBe(0);
      expect(JSON.parse(capacitor.stdout)).toEqual([
        "www.theninja-rpg.com",
        "clerk.theninja-rpg.com",
      ]);
      const entry = await loadEntry(entryConfig);
      expect(entry.origin).toBe(PRODUCTION);
      expect(entry.navigated).toEqual([PRODUCTION]);
      expect(entry.requested).toHaveLength(1);
      const health = new URL(entry.requested[0]!);
      expect(health.origin).toBe(PRODUCTION);
      expect(health.pathname).toBe("/api/healthcheck");
      expect(health.searchParams.has("t")).toBe(true);
    }, 30_000);
  }

  for (const origin of [
    "https://staging.example.com",
    "https://www.theninja-rpg.com:8443",
    "https://www.theninja-rpg.com.example.org",
  ]) {
    it(`trusts only the configured host for ${origin}`, async () => {
      const { capacitor, writer, entryConfig } = readConfiguration(`${origin}/`);
      expect(capacitor.status).toBe(0);
      expect(writer.status).toBe(0);
      expect(JSON.parse(capacitor.stdout)).toEqual([new URL(origin).host]);
      const entry = await loadEntry(entryConfig);
      expect(entry.origin).toBe(origin);
      expect(entry.navigated).toEqual([origin]);
      expect(new URL(entry.requested[0]!).href).toStartWith(
        `${origin}/api/healthcheck?t=`,
      );
    }, 30_000);
  }

  for (const rawOrigin of [
    "",
    "not-a-url",
    "http://staging.example.com",
    "javascript:alert(1)",
    `${PRODUCTION}/game`,
    `${PRODUCTION}/game/..`,
    `${PRODUCTION}//`,
    `${PRODUCTION}?preview=1`,
    `${PRODUCTION}?`,
    `${PRODUCTION}#game`,
    `${PRODUCTION}#`,
    "https://user:password@www.theninja-rpg.com",
    "https://@www.theninja-rpg.com",
    "https://*.theninja-rpg.com",
    "https://%2a.theninja-rpg.com",
    "https://www.theninja-rpg.com\\game",
  ]) {
    it(`rejects ${JSON.stringify(rawOrigin)} in both consumers before writing`, () => {
      const { capacitor, writer, entryConfig } = readConfiguration(rawOrigin);
      expect(capacitor.status).not.toBe(0);
      expect(writer.status).not.toBe(0);
      expect(capacitor.stderr).toContain("TNR_ORIGIN must be a bare HTTPS origin");
      expect(writer.stderr).toContain("TNR_ORIGIN must be a bare HTTPS origin");
      expect(entryConfig).toBe(SENTINEL);
    }, 30_000);
  }
});
