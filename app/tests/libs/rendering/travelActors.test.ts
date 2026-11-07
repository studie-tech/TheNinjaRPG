import { describe, expect, it } from "bun:test";
import { CREATOR_USERNAME, IMG_SECTOR_VS_ICON } from "@/drizzle/constants";
import { isAloneOnTile, travelActorRecipes, travelActionAvailability, type TravelActorsSnapshot } from "@/libs/rendering/scenes/travelActors";
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
  it("keeps the creator's tile clear of battle pins so challengers can always reach them", () => {
    const creator = player({ userId: "creator", username: CREATOR_USERNAME, rank: "STUDENT" });
    const challenger = player({ userId: "challenger", status: "BATTLE", battleId: "trial" });
    const result = recipes([creator, challenger]);
    expect(result.map((recipe) => recipe.key)).toEqual(["user:creator"]);
    expect(result[0]?.parts.some((part) => part.kind === "attack")).toBe(true);
  });
  it("still pins a battle beside an ordinary player, and once the creator has left the tile", () => {
    const challenger = player({ userId: "challenger", status: "BATTLE", battleId: "fight" });
    expect(recipes([player(), challenger]).some((recipe) => recipe.battleId === "fight")).toBe(true);
    const fighting = player({ userId: "creator", username: CREATOR_USERNAME, status: "BATTLE", battleId: "own" });
    expect(recipes([fighting, challenger]).filter((recipe) => recipe.battleId).length).toBe(2);
  });
  it("counts only awake players, not fighters or NPCs, when judging a tile alone", () => {
    const target = player();
    expect(isAloneOnTile([target, player({ userId: "fighter", status: "BATTLE" }), player({ userId: "npc", isNpc: true }), player({ userId: "self" })], target, "self")).toBe(true);
    expect(isAloneOnTile([target, player({ userId: "two" })], target, "self")).toBe(false);
  });
  it("keeps the viewer and NPC placements while representing crowded players with a count", () => {
    const result = recipes([player(), player({ userId: "two" }), player({ userId: "self" }), player({ isNpc: true, npcPlacementId: "guide" })]);
    expect(result.filter((recipe) => recipe.counter).map((recipe) => recipe.counter)).toEqual([4]);
    expect(result.filter((recipe) => recipe.user).map((recipe) => recipe.key)).toEqual(["user:other", "user:two", "user:self", "npc:guide"]);
    expect(result.filter((recipe) => recipe.user).every((recipe) => recipe.spread)).toBe(true);
  });
  it("never exposes self actions or a masked profile", () => {
    expect(travelActionAvailability(viewer, player({ userId: "self" }), true, null)).toEqual({ attack: false, heal: false, info: false });
    expect(travelActionAvailability(viewer, player({ isMasked: true }), false, null).info).toBe(false);
  });
});
