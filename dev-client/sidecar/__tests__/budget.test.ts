import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isTokenCapExceeded, recordUsage, todayUtc, tokensUsedToday } from "../budget";

let tmpHome: string;

beforeAll(() => {
  tmpHome = mkdtempSync(join(tmpdir(), "tnr-dev-client-budget-"));
  process.env.TNR_DEV_CLIENT_HOME = tmpHome;
});

afterAll(() => {
  delete process.env.TNR_DEV_CLIENT_HOME;
  rmSync(tmpHome, { recursive: true, force: true });
});

test("todayUtc uses the UTC day, not local time", () => {
  expect(todayUtc(new Date("2026-08-19T23:59:00Z"))).toBe("2026-08-19");
  expect(todayUtc(new Date("2026-08-20T00:00:00Z"))).toBe("2026-08-20");
});

test("isTokenCapExceeded matches the server semantics", () => {
  expect(isTokenCapExceeded(0, 0)).toBe(false); // 0 cap = unlimited
  expect(isTokenCapExceeded(9_999_999, 0)).toBe(false);
  expect(isTokenCapExceeded(4, 5)).toBe(false);
  expect(isTokenCapExceeded(5, 5)).toBe(true);
  expect(isTokenCapExceeded(6, 5)).toBe(true);
});

test("recordUsage accumulates per agent per UTC day", () => {
  const day = new Date("2026-08-19T12:00:00Z");
  recordUsage("CLAUDE", 100, day);
  recordUsage("CLAUDE", 50, day);
  recordUsage("CODEX", 30, day);
  expect(tokensUsedToday("CLAUDE", day)).toBe(150);
  expect(tokensUsedToday("CODEX", day)).toBe(30);
  // A different day is isolated.
  expect(tokensUsedToday("CLAUDE", new Date("2026-08-20T12:00:00Z"))).toBe(0);
});

test("recordUsage ignores non-positive amounts", () => {
  const day = new Date("2026-08-21T12:00:00Z");
  recordUsage("CLAUDE", 0, day);
  recordUsage("CLAUDE", -10, day);
  expect(tokensUsedToday("CLAUDE", day)).toBe(0);
});
