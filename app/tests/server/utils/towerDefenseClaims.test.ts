import { afterEach, describe, expect, it, vi } from "bun:test";
import { env } from "@/env/server.mjs";
import {
  areTowerDefenseClaimsEnabled,
  fetchSpacetimeCompletedRun,
  parseSpacetimeSqlRows,
  towerDefenseClaimKey,
} from "@/server/utils/towerDefenseClaims";

// Response shape recorded from a SpacetimeDB `/v1/database/:name/sql` call
const sqlResponse = (row: unknown[] | null) => [
  {
    schema: {
      elements: [
        { name: { some: "id" }, algebraic_type: { U64: [] } },
        { name: { some: "session_id" }, algebraic_type: { U64: [] } },
        { name: { some: "ninjarpg_user_id" }, algebraic_type: { String: [] } },
      ],
    },
    rows: row ? [row] : [],
    total_duration_micros: 100,
    stats: { rows_inserted: 0, rows_deleted: 0, rows_updated: 0 },
  },
];

describe("tower defense claim switch", () => {
  const configured = env.TOWER_DEFENSE_CLAIMS_ENABLED;
  const setSwitch = (value: string | undefined) =>
    Object.assign(env, { TOWER_DEFENSE_CLAIMS_ENABLED: value });
  afterEach(() => setSwitch(configured));

  it("is paused unless explicitly enabled", () => {
    setSwitch(undefined);
    expect(areTowerDefenseClaimsEnabled()).toBe(false);
    setSwitch("false");
    expect(areTowerDefenseClaimsEnabled()).toBe(false);
    setSwitch("1");
    expect(areTowerDefenseClaimsEnabled()).toBe(false);
    setSwitch("true");
    expect(areTowerDefenseClaimsEnabled()).toBe(true);
  });
});

describe("tower defense claim key", () => {
  it("depends on the signed nonce only", () => {
    expect(towerDefenseClaimKey("abc-123")).toBe("nonce:abc-123");
  });
});

describe("parseSpacetimeSqlRows", () => {
  it("keys row values by column name", () => {
    expect(parseSpacetimeSqlRows(sqlResponse([1, 7, "user-a"]))).toEqual([
      { id: 1, session_id: 7, ninjarpg_user_id: "user-a" },
    ]);
  });

  it("returns no rows for an empty result", () => {
    expect(parseSpacetimeSqlRows(sqlResponse(null))).toEqual([]);
  });

  it("rejects malformed responses", () => {
    expect(() => parseSpacetimeSqlRows({ error: "nope" })).toThrow();
  });
});

describe("fetchSpacetimeCompletedRun", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never sends a non-numeric session ID to SpacetimeDB", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await fetchSpacetimeCompletedRun("1 OR 1=1")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("mints an identity when anonymous reads are refused", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("Authorization");
      calls.push({ url, auth });
      if (url.endsWith("/v1/identity")) return Response.json({ token: "minted" });
      if (!auth) return new Response("unauthorized", { status: 401 });
      return Response.json(sqlResponse(null));
    });

    expect(await fetchSpacetimeCompletedRun("42")).toBeNull();
    expect(calls.map((call) => call.url.split("/v1/")[1])).toEqual([
      "database/towerdefense/sql",
      "identity",
      "database/towerdefense/sql",
    ]);
    expect(calls[2]?.auth).toBe("Bearer minted");
  });

  it("throws when SpacetimeDB is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("down", { status: 502 }),
    );
    await expect(fetchSpacetimeCompletedRun("42")).rejects.toThrow();
  });
});
