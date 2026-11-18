import { describe, expect, it } from "bun:test";
import type { ExtraState } from "@/libs/combat/types";
import {
  packBattleExtraState,
  unpackBattleExtraState,
} from "@/server/utils/battleStorage";

const extraState = {
  jutsus: { j1: { id: "j1", name: "Fireball", effects: [] } },
  items: {},
  userQuests: { u1: [{ questId: "q1", quest: { content: { objectives: [] } } }] },
  settings: [{ name: "doubleXp", time: "2026-11-18T10:00:00.000Z" }],
  revealedActions: { jutsuIds: ["j1"], itemIds: [] },
  encounter: { pendingWaves: [] },
  energyRegeneration: { u1: 2 },
  energyRewardEligible: true,
} as unknown as ExtraState;

describe("battle storage", () => {
  it("compresses the read-only catalogs and keeps turn-written state as JSON", () => {
    const stored = packBattleExtraState(extraState);
    expect(Object.keys(stored.extraState).sort()).toEqual([
      "encounter",
      "energyRegeneration",
      "energyRewardEligible",
      "revealedActions",
    ]);
    expect(stored.catalogs.byteLength).toBeGreaterThan(0);
    // Packing copies the state; the caller's battle keeps its catalogs.
    expect(extraState.jutsus).toBeDefined();
  });

  it("restores the complete extraState as the JSON column would return it", () => {
    const stored = packBattleExtraState(extraState);
    const json = JSON.parse(JSON.stringify(stored.extraState)) as ExtraState;
    expect(unpackBattleExtraState(json, stored.catalogs)).toEqual(
      JSON.parse(JSON.stringify(extraState)),
    );
  });

  it("reads rows that store every catalog in the JSON column", () => {
    expect(unpackBattleExtraState(extraState, null)).toBe(extraState);
  });

  it("lets the JSON column win over a stale catalog copy of the same key", () => {
    const stored = packBattleExtraState(extraState);
    const json = { ...stored.extraState, settings: [] } as ExtraState;
    expect(unpackBattleExtraState(json, stored.catalogs).settings).toEqual([]);
  });
});
