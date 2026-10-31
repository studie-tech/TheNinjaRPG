import { describe, expect, it } from "bun:test";
import { IMG_SECTOR_VS_ICON } from "@/drizzle/constants";
import { travelActorRecipes, travelActionAvailability, type TravelActorsSnapshot } from "@/libs/rendering/scenes/travelActors";
import type { SectorUser } from "@/libs/sector-map/world-types";
import type { UserWithRelations } from "@/routers/profile";

const grid = { getHex: ({ col, row }: { col: number; row: number }) => ({ col, row, width: 20, height: 10, center: { x: -col * 20, y: -row * 10 } }) } as never;
const player = (patch: Partial<SectorUser> = {}): SectorUser => ({ userId: "other", status: "AWAKE", rank: "JONIN", allianceStatus: "NEUTRAL", longitude: 5, latitude: 5, experience: 0, avatar: "avatar.webp", avatarLight: "light.webp", ...patch }) as SectorUser;
const viewer = { userId: "self", sector: 724, userQuests: [], questData: [], rank: "JONIN" } as unknown as NonNullable<UserWithRelations>;
const recipes = (users: SectorUser[], patch: Partial<TravelActorsSnapshot> = {}) => travelActorRecipes({ grid, users, viewer, sector: 724, minBracket: -1, showUsers: true, friendlyAttack: false, structureObjectiveIds: new Set(), ...patch });

describe("travel actor snapshots", () => {
  it.each([-1, 2])("keeps the own marker at bracket %s while filtering other players", (minBracket) => {
    const result = recipes([player({ userId: "self" }), player(), player({ userId: "matching", longitude: 6, experience: 600_000 })], { minBracket });
    expect(result.some((recipe) => recipe.key === "user:self")).toBe(true);
    expect(result.some((recipe) => recipe.key === "user:other")).toBe(minBracket === -1);
    expect(result.some((recipe) => recipe.key === "user:matching")).toBe(true);
  });
  it("keeps only the own marker when active users are hidden", () => {
    expect(recipes([player(), player({ userId: "self" })], { showUsers: false }).map((recipe) => recipe.key)).toEqual(["user:self"]);
  });
  it.each(["FRIENDLY", "HOSTILE"] as const)("keeps independent placement identities for %s NPCs", (npcInteractionType) => {
    const result = recipes([player({ isNpc: true, npcPlacementId: "one", npcInteractionType }), player({ isNpc: true, npcPlacementId: "two", npcInteractionType })], { minBracket: 8 });
    expect(result.map((recipe) => recipe.key)).toEqual(["npc:one", "npc:two"]);
    expect(result[0]?.parts.map((part) => part.kind)).toEqual(["avatar", npcInteractionType === "HOSTILE" ? "attack" : "talk"]);
    expect(result[0]?.parts[0]).toMatchObject({ image: "avatar.webp", rendition: 256 });
  });
  it("omits restricted attack actions while preserving healing and profile details", () => {
    expect(recipes([player({ rank: "STUDENT" })])[0]?.parts.map((part) => part.kind)).toEqual(["marker", "marker", "avatar", "heal", "info"]);
  });
  it("preserves solo PvE battle pins and adds a second portrait when available", () => {
    const solo = recipes([player({ status: "BATTLE", battleId: "battle" })]);
    const pair = recipes([player({ status: "BATTLE", battleId: "battle" }), player({ userId: "foe", status: "BATTLE", battleId: "battle" })]);
    expect(solo[0]?.battleId).toBe("battle");
    expect(solo[0]?.parts.some((part) => part.image === IMG_SECTOR_VS_ICON)).toBe(true);
    expect(pair[0]?.parts.length).toBe((solo[0]?.parts.length ?? 0) + 1);
  });
  it("keeps the viewer and NPC placements while representing crowded players with a count", () => {
    const result = recipes([player(), player({ userId: "two" }), player({ userId: "self" }), player({ isNpc: true, npcPlacementId: "guide" })]);
    expect(result.filter((recipe) => recipe.counter).map((recipe) => recipe.counter)).toEqual([4]);
    expect(result.filter((recipe) => recipe.user).map((recipe) => recipe.key)).toEqual(["user:other", "user:two", "user:self", "npc:guide"]);
    expect(result.filter((recipe) => recipe.user).every((recipe) => recipe.spread)).toBe(true);
  });
  it("never exposes self actions or a masked profile", () => {
    expect(travelActionAvailability(viewer, player({ userId: "self" }), true)).toEqual({ attack: false, heal: false, info: false });
    expect(travelActionAvailability(viewer, player({ isMasked: true }), false).info).toBe(false);
  });
});
