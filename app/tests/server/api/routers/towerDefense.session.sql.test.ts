import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { towerDefenseCharacter } from "@/drizzle/schema";
import { towerDefenseRouter } from "@/server/api/routers/towerDefense";
import { stubRateLimitTransport } from "../../../setup/rateLimit";
import {
  callerFor,
  describeWithDatabase,
  getTestDatabase,
  resetTables,
} from "../../../setup/testDatabase";

describeWithDatabase("tower defense session definitions", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    stubRateLimitTransport();
    await resetTables(towerDefenseCharacter);
    await (await getTestDatabase()).insert(towerDefenseCharacter).values([
      {
        id: "enemy",
        name: "Enemy",
        baseHealth: 11,
        baseSpeed: 1.5,
        baseDamage: 13,
        attackCooldown: 2.5,
        healthScaling: 0.25,
        speedScaling: 0.5,
        damageScaling: 3.5,
        firstAppearWave: 4,
        baseCount: 6,
        countScaling: 1.25,
      },
      { id: "hero", name: "Hero", isPlayer: true },
    ]);
  });

  it("signs enemy definitions under the canonical field order", async () => {
    const session = await (
      await callerFor(towerDefenseRouter, "guest")
    ).initiateGuestSession();
    expect(session.enemyDefinitions).toEqual([
      {
        id: "enemy",
        enemyType: "enemy",
        baseHealth: 11,
        baseSpeed: 1.5,
        baseDamage: 13,
        attackCooldown: 2.5,
        healthScaling: 0.25,
        speedScaling: 0.5,
        damageScaling: 3.5,
        firstAppearWave: 4,
        baseCount: 6,
        countScaling: 1.25,
      },
    ]);
    expect(Object.keys(session.enemyDefinitions[0] ?? {})).toEqual([
      "id",
      "enemyType",
      "baseHealth",
      "baseSpeed",
      "baseDamage",
      "attackCooldown",
      "healthScaling",
      "speedScaling",
      "damageScaling",
      "firstAppearWave",
      "baseCount",
      "countScaling",
    ]);
  });
});
