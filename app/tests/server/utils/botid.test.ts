import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { env } from "@/env/server.mjs";
import {
  BOTID_BLOCKED_MESSAGE,
  BOTID_DEEP_ANALYSIS_PROCEDURES,
  BOTID_PROTECTED_PROCEDURES,
  BOTID_PROTECTED_ROUTES,
  BOTID_RELOAD_REQUIRED_MESSAGE,
  isBotIdProtectedProcedure,
} from "@/libs/botid";

// Bun shares module mocks across test files, so the mock lives on globalThis.
const getCheckBotId = () => {
  const globals = globalThis as typeof globalThis & {
    __botIdCheckMock?: ReturnType<typeof vi.fn>;
  };
  globals.__botIdCheckMock ??= vi.fn();
  return globals.__botIdCheckMock;
};
const checkBotId = getCheckBotId();

vi.mock("botid/server", () => ({ checkBotId: getCheckBotId() }));

import {
  createBotIdGuard,
  enforceBotId,
  isBotIdEnforced,
  BOTID_DEEP_ANALYSIS_TIMEOUT_MS,
  BOTID_TIMEOUT_MS,
  runBotIdCheck,
  shouldGuardTrpcRequest,
  shouldLogBotIdTiming,
  trpcPathsFromUrl,
  withBotIdGuard,
} from "@/server/utils/botid";

const human = { isHuman: true, isBot: false, isVerifiedBot: false, bypassed: false };
const bot = { isHuman: false, isBot: true, isVerifiedBot: false, bypassed: false };

const mutation = { type: "mutation", path: "train.startTraining", userId: "user-1" };

/** Run one mutation's middleware inside a fresh guarded request. */
const guardedMutation = (verdict: object) => {
  checkBotId.mockResolvedValue(verdict);
  const guard = createBotIdGuard(["train.startTraining"]);
  return { guard, run: () => withBotIdGuard(guard, () => enforceBotId(mutation)) };
};

const originalSetting = env.BOTID_ENFORCE;
const originalVercelEnv = process.env.VERCEL_ENV;
let warn: { mock: { calls: unknown[][] }; mockRestore: () => void };
let info: { mock: { calls: unknown[][] }; mockRestore: () => void };

/** The `[botid-timing]` records logged so far. */
const timings = () =>
  info.mock.calls
    .map(([line]: unknown[]) => String(line))
    .filter((line: string) => line.startsWith("[botid-timing] "))
    .map(
      (line: string) =>
        JSON.parse(line.slice("[botid-timing] ".length)) as Record<string, unknown>,
    );

/** The structured `[botid]` records logged so far. */
const records = () =>
  warn.mock.calls
    .map(([line]: unknown[]) => String(line))
    .filter((line: string) => line.startsWith("[botid] "))
    .map((line: string) => JSON.parse(line.slice("[botid] ".length)) as Record<string, unknown>);

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  env.BOTID_ENFORCE = undefined;
  process.env.VERCEL_ENV = "production";
});

afterEach(() => {
  warn.mockRestore();
  info.mockRestore();
  checkBotId.mockReset();
  env.BOTID_ENFORCE = originalSetting;
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
});

describe("BotID check level", () => {
  it("asks for Basic on the client protect entry and on the server check alike", async () => {
    expect(BOTID_PROTECTED_ROUTES).toHaveLength(BOTID_PROTECTED_PROCEDURES.length);
    for (const route of BOTID_PROTECTED_ROUTES) {
      const deep = BOTID_DEEP_ANALYSIS_PROCEDURES.some((p) => route.path.includes(p));
      expect(route).toMatchObject({
        method: "POST",
        advancedOptions: { checkLevel: deep ? "deepAnalysis" : "basic" },
      });
    }
    checkBotId.mockResolvedValue(human);
    await runBotIdCheck();
    expect(checkBotId).toHaveBeenCalledWith({
      advancedOptions: { checkLevel: "basic" },
    });
  });

  it("uses Deep Analysis for account creation only, on both client and server", async () => {
    expect([...BOTID_DEEP_ANALYSIS_PROCEDURES]).toEqual(["register.createCharacter"]);
    for (const procedure of BOTID_DEEP_ANALYSIS_PROCEDURES) {
      expect(isBotIdProtectedProcedure(procedure)).toBe(true);
    }
    // botid attaches the challenge of the first matching entry, so deep entries lead.
    expect(BOTID_PROTECTED_ROUTES[0]).toMatchObject({
      path: "/api/trpc/*register.createCharacter*",
      advancedOptions: { checkLevel: "deepAnalysis" },
    });
    checkBotId.mockResolvedValue(human);
    const guard = createBotIdGuard(["register.createCharacter"]);
    expect(guard.checkLevel).toBe("deepAnalysis");
    await guard.verify();
    expect(checkBotId).toHaveBeenCalledWith({
      advancedOptions: { checkLevel: "deepAnalysis" },
    });
  });

  it("checks a batch with account creation at the Deep Analysis level", () => {
    expect(createBotIdGuard(["bank.transfer", "register.createCharacter"]).checkLevel).toBe(
      "deepAnalysis",
    );
    expect(createBotIdGuard(["bank.transfer"]).checkLevel).toBe("basic");
  });

  it("gives Deep Analysis a longer fail-open budget than Basic", () => {
    expect(BOTID_DEEP_ANALYSIS_TIMEOUT_MS).toBeGreaterThan(BOTID_TIMEOUT_MS);
    expect(BOTID_DEEP_ANALYSIS_TIMEOUT_MS).toBeLessThanOrEqual(2000);
  });
});

describe("runBotIdCheck", () => {
  it("returns the BotID fields", async () => {
    checkBotId.mockResolvedValue({
      ...bot,
      isVerifiedBot: true,
      verifiedBotName: "googlebot",
    });
    expect(await runBotIdCheck()).toEqual({
      ok: true,
      ...bot,
      isVerifiedBot: true,
      verifiedBotName: "googlebot",
    });
  });

  it("resolves to a failed verdict when BotID throws", async () => {
    checkBotId.mockRejectedValue(new Error("VERCEL_OIDC_TOKEN is not set"));
    expect(await runBotIdCheck()).toEqual({
      ok: false,
      reason: "VERCEL_OIDC_TOKEN is not set",
    });
  });

  it("resolves to a failed verdict when BotID does not answer in time", async () => {
    checkBotId.mockReturnValue(new Promise(() => undefined));
    expect(await runBotIdCheck(20)).toEqual({
      ok: false,
      reason: "checkBotId timed out after 20ms",
    });
  });
});

describe("createBotIdGuard", () => {
  it("checks once per request, however many procedures ask", async () => {
    checkBotId.mockResolvedValue(human);
    const guard = createBotIdGuard(["a.b", "c.d"]);
    await Promise.all([guard.verify(), guard.verify(), guard.verify()]);
    expect(checkBotId).toHaveBeenCalledTimes(1);
  });
});

describe("enforceBotId", () => {
  it("lets a human through without recording anything", async () => {
    const { guard, run } = guardedMutation(human);
    await expect(run()).resolves.toBeUndefined();
    expect(records()).toEqual([]);
    expect(guard.needsFlush).toBe(false);
  });

  it("blocks a bot in production by default and records the verdict", async () => {
    const { guard, run } = guardedMutation(bot);
    const error = await run().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({ code: "FORBIDDEN", message: BOTID_BLOCKED_MESSAGE });
    expect(records()).toEqual([
      {
        event: "blocked",
        userId: "user-1",
        path: "train.startTraining",
        paths: ["train.startTraining"],
        checkLevel: "basic",
        userAgent: null,
        isBot: true,
        isHuman: false,
        isVerifiedBot: false,
        verifiedBotName: null,
        bypassed: false,
      },
    ]);
    // A Sentry event was captured, which the route flushes.
    expect(guard.needsFlush).toBe(true);
  });

  it("only records a bot when the kill switch is set", async () => {
    env.BOTID_ENFORCE = "false";
    const { guard, run } = guardedMutation(bot);
    await expect(run()).resolves.toBeUndefined();
    expect(records()).toMatchObject([{ event: "observed", isBot: true }]);
    expect(guard.needsFlush).toBe(true);
  });

  it("only records a bot on a preview deployment unless enforcement is forced", async () => {
    process.env.VERCEL_ENV = "preview";
    await expect(guardedMutation(bot).run()).resolves.toBeUndefined();
    env.BOTID_ENFORCE = "true";
    await expect(guardedMutation(bot).run()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails open when BotID errors, logging without a Sentry event", async () => {
    checkBotId.mockRejectedValue(new Error("fetch failed"));
    const guard = createBotIdGuard(["train.startTraining"]);
    await expect(
      withBotIdGuard(guard, () => enforceBotId(mutation)),
    ).resolves.toBeUndefined();
    expect(records()).toMatchObject([{ event: "check_failed", reason: "fetch failed" }]);
    expect(guard.needsFlush).toBe(false);
  });

  it("checks and records a batch once while rejecting each of its mutations", async () => {
    checkBotId.mockResolvedValue(bot);
    const guard = createBotIdGuard(["train.startTraining", "bank.transfer"]);
    const results = await withBotIdGuard(guard, () =>
      Promise.allSettled([
        enforceBotId({ ...mutation, path: "train.startTraining" }),
        enforceBotId({ ...mutation, path: "bank.transfer" }),
      ]),
    );
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(checkBotId).toHaveBeenCalledTimes(1);
    expect(records()).toHaveLength(1);
  });

  it("lets unprotected mutations through without waiting for BotID", async () => {
    checkBotId.mockResolvedValue(bot);
    const guard = createBotIdGuard(["train.startTraining", "combat.performAction"]);
    await expect(
      withBotIdGuard(guard, () =>
        enforceBotId({ ...mutation, path: "combat.performAction" }),
      ),
    ).resolves.toBeUndefined();
    expect(checkBotId).not.toHaveBeenCalled();
    expect(records()).toEqual([]);
  });

  it("ignores queries", async () => {
    checkBotId.mockResolvedValue(bot);
    const guard = createBotIdGuard([]);
    await withBotIdGuard(guard, () => enforceBotId({ ...mutation, type: "query" }));
    expect(checkBotId).not.toHaveBeenCalled();
  });

  it("ignores server-side callers, which run outside a guarded request", async () => {
    checkBotId.mockResolvedValue(bot);
    await expect(enforceBotId(mutation)).resolves.toBeUndefined();
    expect(checkBotId).not.toHaveBeenCalled();
  });
});

describe("enforceBotId without a challenge", () => {
  const unchallenged = (paths: string[]) =>
    createBotIdGuard(paths, { hasChallenge: false, userAgent: "Mozilla/5.0" });

  it("asks a page without a challenge to reload, without calling BotID", async () => {
    const guard = unchallenged(["train.startTraining"]);
    const error = await withBotIdGuard(guard, () => enforceBotId(mutation)).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(TRPCError);
    expect(error).toMatchObject({
      code: "PRECONDITION_FAILED",
      message: BOTID_RELOAD_REQUIRED_MESSAGE,
    });
    expect(checkBotId).not.toHaveBeenCalled();
    expect(records()).toEqual([
      {
        event: "missing_challenge",
        userId: "user-1",
        path: "train.startTraining",
        paths: ["train.startTraining"],
        checkLevel: "basic",
        userAgent: "Mozilla/5.0",
        enforced: true,
      },
    ]);
    expect(guard.needsFlush).toBe(true);
  });

  it("records once per batch while rejecting each blocking mutation", async () => {
    const guard = unchallenged(["train.startTraining", "bank.transfer"]);
    const results = await withBotIdGuard(guard, () =>
      Promise.allSettled([
        enforceBotId({ ...mutation, path: "train.startTraining" }),
        enforceBotId({ ...mutation, path: "bank.transfer" }),
      ]),
    );
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(records()).toHaveLength(1);
  });

  it("only records when enforcement is off", async () => {
    env.BOTID_ENFORCE = "false";
    const guard = unchallenged(["train.startTraining"]);
    await expect(
      withBotIdGuard(guard, () => enforceBotId(mutation)),
    ).resolves.toBeUndefined();
    expect(records()).toMatchObject([{ event: "missing_challenge", enforced: false }]);
  });

  it("still ignores unprotected mutations", async () => {
    const guard = unchallenged(["train.startTraining", "combat.performAction"]);
    await expect(
      withBotIdGuard(guard, () =>
        enforceBotId({ ...mutation, path: "combat.performAction" }),
      ),
    ).resolves.toBeUndefined();
    expect(records()).toEqual([]);
  });
});

describe("isBotIdEnforced", () => {
  it.each([
    [undefined, "production", true],
    [undefined, "preview", false],
    [undefined, undefined, false],
    ["false", "production", false],
    ["true", "preview", true],
  ] as const)("BOTID_ENFORCE=%s on %s → %s", (setting, vercelEnv, expected) => {
    expect(isBotIdEnforced({ setting, vercelEnv })).toBe(expected);
  });
});

describe("shouldGuardTrpcRequest", () => {
  it("guards POSTs on Vercel that name a protected procedure", () => {
    expect(shouldGuardTrpcRequest("POST", ["train.startTraining"], true)).toBe(true);
    expect(
      shouldGuardTrpcRequest("POST", ["combat.performAction", "merch.addToCart"], true),
    ).toBe(true);
    expect(shouldGuardTrpcRequest("POST", ["combat.performAction"], true)).toBe(false);
    expect(shouldGuardTrpcRequest("GET", ["train.startTraining"], true)).toBe(false);
    expect(shouldGuardTrpcRequest("POST", ["train.startTraining"], false)).toBe(false);
  });
});

describe("trpcPathsFromUrl", () => {
  it("lists every procedure of a batched request", () => {
    expect(
      trpcPathsFromUrl("https://www.theninja-rpg.com/api/trpc/a.b%2Cc.d?batch=1"),
    ).toEqual(["a.b", "c.d"]);
    expect(trpcPathsFromUrl("https://x.test/api/trpc/a.b,c.d?batch=1")).toEqual([
      "a.b",
      "c.d",
    ]);
  });
});

describe("BotID timing", () => {
  it("caps the round trip well below a noticeable delay", () => {
    expect(BOTID_TIMEOUT_MS).toBeLessThanOrEqual(500);
  });

  it("logs the check and wait time once per request, however many mutations it carries", async () => {
    process.env.VERCEL_ENV = "preview";
    checkBotId.mockResolvedValue(human);
    const guard = createBotIdGuard(["train.startTraining", "bank.transfer"]);
    await withBotIdGuard(guard, () =>
      Promise.all([
        enforceBotId({ ...mutation, path: "train.startTraining" }),
        enforceBotId({ ...mutation, path: "bank.transfer" }),
      ]),
    );
    const logged = timings();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      timeoutMs: BOTID_TIMEOUT_MS,
      ok: true,
      isBot: false,
      vercelEnv: "preview",
    });
    expect(typeof logged[0]?.checkMs).toBe("number");
    expect(typeof logged[0]?.waitedMs).toBe("number");
    expect(guard.checkMs).toBeGreaterThanOrEqual(0);
  });

  it("records a timed-out check as failed with its timing", async () => {
    process.env.VERCEL_ENV = "preview";
    const guard = createBotIdGuard(["train.startTraining"], {
      check: () => runBotIdCheck(20),
    });
    checkBotId.mockReturnValue(new Promise(() => undefined));
    await withBotIdGuard(guard, () => enforceBotId(mutation));
    expect(timings()[0]).toMatchObject({ ok: false, isBot: null });
    expect(guard.checkMs).toBeGreaterThanOrEqual(15);
  });

  it("logs every preview request and samples production", () => {
    expect(shouldLogBotIdTiming("preview", () => 0.99)).toBe(true);
    expect(shouldLogBotIdTiming("production", () => 0.05)).toBe(true);
    expect(shouldLogBotIdTiming("production", () => 0.5)).toBe(false);
  });
});

describe("BotID protected procedures", () => {
  /** The client-side matcher botid@1.5 applies to a request's pathname. */
  const clientMatches = (routePath: string, pathname: string) =>
    new RegExp(
      `^${routePath.replace(/[.?+^$[\]\\(){}|-]/g, "\\$&").split("*").join(".*")}$`,
    ).test(pathname);
  const matchedBy = (pathname: string) =>
    BOTID_PROTECTED_ROUTES.filter((route) => clientMatches(route.path, pathname));

  it("lists each procedure once", () => {
    expect(new Set(BOTID_PROTECTED_PROCEDURES).size).toBe(BOTID_PROTECTED_PROCEDURES.length);
  });

  it("attaches the challenge to protected mutations, alone or batched", () => {
    expect(matchedBy("/api/trpc/train.startTraining")).toHaveLength(1);
    expect(matchedBy("/api/trpc/train.startMasteryTraining")).toHaveLength(1);
    expect(matchedBy("/api/trpc/profile.getUser,merch.addToCart")).toHaveLength(1);
    expect(matchedBy("/api/trpc/combat.performAction%2Cbank.transfer")).toHaveLength(1);
  });

  it("leaves frequent mutations alone", () => {
    for (const pathname of [
      "/api/trpc/combat.performAction",
      "/api/trpc/travel.moveInSector",
      "/api/trpc/item.toggleEquip",
      "/api/trpc/comments.sendTypingIndicator",
    ]) {
      expect(matchedBy(pathname)).toEqual([]);
    }
    expect(isBotIdProtectedProcedure("combat.performAction")).toBe(false);
    expect(isBotIdProtectedProcedure("jutsu.startTraining")).toBe(true);
  });
});

describe("BotID client matcher with mixed check levels", () => {
  const clientRegex = (routePath: string) =>
    new RegExp(
      `^${routePath.replace(/[.?+^$[\]\\(){}|-]/g, "\\$&").split("*").join(".*")}$`,
    );
  /** botid@1.5 attaches the challenge of the first matching protect entry. */
  const firstMatch = (pathname: string) =>
    BOTID_PROTECTED_ROUTES.find((route) => clientRegex(route.path).test(pathname));

  it("agrees with the server on the level for single and batched requests", () => {
    for (const paths of [
      ["register.createCharacter"],
      ["profile.getUser", "register.createCharacter"],
      ["bank.transfer", "register.createCharacter"],
      ["train.startTraining"],
    ]) {
      const route = firstMatch(`/api/trpc/${paths.join(",")}`);
      expect(route?.advancedOptions.checkLevel).toBe(createBotIdGuard(paths).checkLevel);
    }
  });
});
