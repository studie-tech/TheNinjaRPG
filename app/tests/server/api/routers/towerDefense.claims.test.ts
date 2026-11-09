import { rateLimitResponse } from "../../../setup/rateLimit";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { eq } from "drizzle-orm";
import { towerDefenseClaimReceipt, towerDefenseRun, userData } from "@/drizzle/schema";
import { env } from "@/env/server.mjs";
import { towerDefenseRouter } from "@/server/api/routers/towerDefense";
import {
  type SessionParams,
  signSessionParams,
} from "@/server/utils/towerDefenseCrypto";
import { TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE } from "@/server/utils/towerDefenseClaims";
import type { SpacetimeCompletedRun } from "@/validators/towerDefense";
import { insertUsers } from "../../../setup/factories";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

const upgradeDefinitions = [
  {
    id: "u1",
    maxLevel: 5,
    baseCost: 10,
    costMultiplier: 1.5,
    effectValue: 1,
    upgradeType: "DAMAGE",
  },
];
const enemyDefinitions = [
  {
    id: "e1",
    enemyType: "basic",
    baseHealth: 10,
    baseSpeed: 2,
    baseDamage: 5,
    attackCooldown: 1,
    healthScaling: 0.1,
    speedScaling: 0,
    damageScaling: 1,
    firstAppearWave: 1,
    baseCount: 3,
    countScaling: 1,
  },
];
const definitions = {
  upgradeDefinitionsJson: JSON.stringify(upgradeDefinitions),
  enemyDefinitionsJson: JSON.stringify(enemyDefinitions),
};

/** A completed_run row as the SpacetimeDB module would write it for a signed session. */
const completedRun = (
  overrides: {
    userId?: string;
    nonce?: string;
    sessionId?: number;
    finalScore?: number;
    signer?: string;
  } = {},
): SpacetimeCompletedRun => {
  const userId = overrides.userId ?? "td-user";
  const nonce = overrides.nonce ?? "nonce-1";
  const params: SessionParams = {
    userId: overrides.signer ?? userId,
    nonce,
    abilityDamage: 10,
    abilityRange: 3,
    abilityCooldownMs: 500,
    abilityCritChance: 0.1,
    abilityDamagePerTile: 0,
    playerMaxHealth: 100,
    healthRegen: 0,
    defensePercent: 0,
    defenseFlat: 0,
    lifestealPercent: 0,
    knockbackChance: 0,
    knockbackForce: 0,
    tokensPerWave: 5,
    tokensPerKill: 1,
    interestPerWave: 0,
    skipEnemyChance: 0,
    scorePerKill: 10,
    scoreToPointsRatio: 100,
    initialGridSize: 5,
    maxGridSize: 9,
    gridExpandFreq: 3,
    rangeVisualFactor: 1,
    upgradeDefinitions,
    enemyDefinitions,
  };
  const finalScore = overrides.finalScore ?? 1250;
  return {
    session_id: overrides.sessionId ?? 7,
    ninjarpg_user_id: userId,
    session_signature: signSessionParams(params),
    nonce,
    ability_damage: 10,
    ability_range: 3,
    ability_cooldown_ms: 500,
    ability_crit_chance: 0.1,
    ability_damage_per_tile: 0,
    player_max_health: 100,
    health_regen: 0,
    defense_percent: 0,
    defense_flat: 0,
    lifesteal_percent: 0,
    knockback_chance: 0,
    knockback_force: 0,
    tokens_per_wave: 5,
    tokens_per_kill: 1,
    interest_per_wave: 0,
    skip_enemy_chance: 0,
    score_per_kill: 10,
    score_to_points_ratio: 100,
    initial_grid_size: 5,
    max_grid_size: 9,
    grid_expand_freq: 3,
    range_visual_factor: 1,
    final_wave: 4,
    final_score: finalScore,
    points_earned: Math.floor(finalScore / 100),
  };
};

/** Serves completed_run rows over SpacetimeDB's SQL endpoint and keeps the rate limiter off Redis. */
const stubTransport = (runs: SpacetimeCompletedRun[]) => {
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/sql")) {
      const sessionId = Number(String(init?.body).match(/session_id = (\d+)/)?.[1]);
      const rows = runs.filter((run) => run.session_id === sessionId);
      const columns = Object.keys(completedRun());
      return Response.json([
        {
          schema: { elements: columns.map((column) => ({ name: { some: column } })) },
          rows: rows.map((run) =>
            columns.map((column) => run[column as keyof SpacetimeCompletedRun]),
          ),
        },
      ]);
    }
    const rateLimit = rateLimitResponse(init);
    if (rateLimit) return rateLimit;
    return realFetch(input, init);
  });
};

const points = async (userId: string) => {
  const database = await getTestDatabase();
  const [row] = await database
    .select({ points: userData.towerDefensePoints })
    .from(userData)
    .where(eq(userData.userId, userId));
  return row?.points;
};

describeWithDatabase("towerDefense.claimCompletedRun", () => {
  const configured = env.TOWER_DEFENSE_CLAIMS_ENABLED;
  afterEach(() => Object.assign(env, { TOWER_DEFENSE_CLAIMS_ENABLED: configured }));

  beforeEach(async () => {
    env.TOWER_DEFENSE_CLAIMS_ENABLED = "true";
    await resetTables(towerDefenseClaimReceipt, towerDefenseRun, userData);
    await insertUsers([{ userId: "td-user" }, { userId: "td-other" }]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses every claim while rewards are paused", async () => {
    env.TOWER_DEFENSE_CLAIMS_ENABLED = undefined;
    stubTransport([completedRun()]);
    const api = await callerFor(towerDefenseRouter, "td-user");
    const result = await api.claimCompletedRun({
      spacetimeSessionId: "7",
      ...definitions,
    });
    expect(result).toMatchObject({
      success: false,
      claimsPaused: true,
      message: TOWER_DEFENSE_CLAIMS_PAUSED_MESSAGE,
    });
    expect(await points("td-user")).toBe(0);
  });

  it("pays the SpacetimeDB result once per signed session, across leaderboard resets", async () => {
    stubTransport([
      completedRun(),
      completedRun({ sessionId: 8, finalScore: 900_000 }),
    ]);
    const api = await callerFor(towerDefenseRouter, "td-user");

    const first = await api.claimCompletedRun({
      spacetimeSessionId: "7",
      ...definitions,
    });
    expect(first).toMatchObject({
      success: true,
      pointsEarned: 12,
      finalScore: 1250,
      finalWave: 4,
    });
    expect(await points("td-user")).toBe(12);

    // Another SpacetimeDB session started from the same signed nonce cannot pay again
    expect(
      (await api.claimCompletedRun({ spacetimeSessionId: "8", ...definitions }))
        .success,
    ).toBe(false);
    expect(
      (await api.claimCompletedRun({ spacetimeSessionId: "7", ...definitions }))
        .success,
    ).toBe(false);

    // The monthly reset clears leaderboard runs, but not claim receipts
    const database = await getTestDatabase();
    await database
      .delete(towerDefenseRun)
      .where(eq(towerDefenseRun.status, "COMPLETED"));
    const replay = await api.claimCompletedRun({
      spacetimeSessionId: "7",
      ...definitions,
    });
    expect(replay).toMatchObject({
      success: false,
      message: "This run has already been claimed.",
    });
    expect(await points("td-user")).toBe(12);
  });

  it("allows only one of two concurrent claims", async () => {
    stubTransport([completedRun()]);
    const api = await callerFor(towerDefenseRouter, "td-user");
    const results = await Promise.all([
      api.claimCompletedRun({ spacetimeSessionId: "7", ...definitions }),
      api.claimCompletedRun({ spacetimeSessionId: "7", ...definitions }),
    ]);
    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(await points("td-user")).toBe(12);
  });

  it("rejects runs that belong to another player or were not signed for them", async () => {
    stubTransport([
      completedRun({ userId: "td-other", sessionId: 9 }),
      completedRun({ sessionId: 10, nonce: "nonce-2", signer: "td-other" }),
    ]);
    const api = await callerFor(towerDefenseRouter, "td-user");
    expect(
      (await api.claimCompletedRun({ spacetimeSessionId: "9", ...definitions }))
        .success,
    ).toBe(false);
    expect(
      (await api.claimCompletedRun({ spacetimeSessionId: "10", ...definitions }))
        .success,
    ).toBe(false);
    expect(
      (await api.claimCompletedRun({ spacetimeSessionId: "11", ...definitions }))
        .success,
    ).toBe(false);
    expect(await points("td-user")).toBe(0);
  });

  it("rejects definitions other than the signed ones", async () => {
    stubTransport([completedRun()]);
    const api = await callerFor(towerDefenseRouter, "td-user");
    const tampered = JSON.stringify([{ ...upgradeDefinitions[0], effectValue: 1000 }]);
    const result = await api.claimCompletedRun({
      spacetimeSessionId: "7",
      ...definitions,
      upgradeDefinitionsJson: tampered,
    });
    expect(result.success).toBe(false);
    expect(await points("td-user")).toBe(0);
  });
});
