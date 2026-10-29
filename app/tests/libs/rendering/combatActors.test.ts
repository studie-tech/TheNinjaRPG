import { describe, expect, it } from "bun:test";
import { IMG_BATTLEFIELD_TOMBSTONE } from "@/drizzle/constants";
import type { ReturnedBattle, ReturnedUserState } from "@/libs/combat/types";
import type { TerrainHex } from "@/libs/hexgrid";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { combatActorParts } from "@/libs/rendering/scenes/combatActors";
import { createStatusMeter } from "@/libs/rendering/primitives/statusMeter";
import { makeBattleUser, makeCompleteBattle } from "../combat/helpers/battleScenario";

const tile = { width: 40, height: 20 } as TerrainHex;
const battle = makeCompleteBattle() as unknown as ReturnedBattle;
const user = (patch: Partial<ReturnedUserState> = {}) => makeBattleUser("viewer", { avatar: "portrait.webp", ...patch }) as ReturnedUserState;

describe("combat fighter recipes", () => {
  it("preserves portrait artwork and tombstones without downloading decorative markers", () => {
    const parts = combatActorParts(user({ isAi: false }), tile, battle);
    expect(parts.map((part) => part.kind)).toEqual(["marker", "marker", "avatar", "tombstone"]);
    expect(parts.find((part) => part.kind === "avatar")).toMatchObject({ image: "portrait.webp", size: 16, y: 20 });
    expect(parts.find((part) => part.kind === "tombstone")?.image).toBe(IMG_BATTLEFIELD_TOMBSTONE);
  });
  it("uses unmasked raw AI artwork without decorative asset overlays", () => {
    const fighter = user({ isAi: true, isOriginal: true, isSummon: true, controllerId: "viewer" });
    const parts = combatActorParts(fighter, tile, battle);
    expect(parts.map((part) => part.kind)).toEqual(["aiAvatar", "tombstone"]);
    expect(parts[0]).toMatchObject({ image: "portrait.webp", size: 32, y: 18, rendition: 256 });
    expect(parts[0]?.mask).toBeUndefined();
  });
  it("scales LPC fighters to 75% and raises them within their tile", () => {
    const spriteAppearance = resolveSpriteAppearance({});
    const parts = combatActorParts(user({ isAi: false, spriteAppearance }), tile, battle);
    const avatar = parts.find((part) => part.kind === "avatar")!;
    expect(avatar).toMatchObject({ character: spriteAppearance, size: tile.height * 1.8 * 0.75, y: tile.height * (0.9 * 0.75 + 0.15) });
    expect(avatar.y - avatar.size / 2).toBeCloseTo(tile.height * 0.15);
  });
  it("never mutates the battle or fighter while building its display", () => {
    const fighter = user({ isAi: false }), original = structuredClone(fighter);
    combatActorParts(fighter, tile, battle);
    expect(fighter).toEqual(original);
  });
});

describe("batched status meters", () => {
  it("clamps empty, overfilled and invalid pools without replacing display objects", () => {
    const meter = createStatusMeter({ width: 20, height: 2, color: 0xb22222, y: 30 });
    const fill = meter.container.children[2];
    meter.set(1); const width = fill?.width ?? 0;
    meter.set(0.5); expect(fill?.width).toBeCloseTo(width / 2);
    meter.set(2); expect(fill?.width).toBe(width);
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) { meter.set(value); expect(fill?.visible).toBe(false); }
    expect(meter.container.children).toHaveLength(3);
    meter.container.destroy({ children: true, texture: false, textureSource: false });
  });
  it("updates threat colors even when the amount stays the same", () => {
    const meter = createStatusMeter({ width: 20, height: 2, color: 0xe9bf75, backgroundColor: 0x15232c, trackColor: 0x35414a, y: 30 });
    const fill = meter.container.children[2];
    meter.set(1); const width = fill?.width;
    meter.set(1, 0xf18a63);
    expect(fill).toMatchObject({ tint: 0xf18a63, width });
    expect(meter.container.children[0]).toMatchObject({ tint: 0x15232c });
    expect(meter.container.children[1]).toMatchObject({ tint: 0x35414a });
    meter.container.destroy({ children: true, texture: false, textureSource: false });
  });
});
