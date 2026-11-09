import { describe, expect, it } from "bun:test";
import { CREATOR_USERNAME, IMG_SECTOR_VS_ICON } from "@/drizzle/constants";
import {
  isAloneOnTile,
  type TravelActorsSnapshot,
  travelActionAvailability,
  travelActorRecipes,
} from "@/libs/rendering/scenes/travelActors";
import type { SectorUser } from "@/libs/sector-map/world-types";
import type { UserWithRelations } from "@/routers/profile";

const grid = {
  getHex: ({ col, row }: { col: number; row: number }) => ({
    col,
    row,
    width: 20,
    height: 10,
    center: { x: -col * 20, y: -row * 10 },
  }),
} as never;
const player = (patch: Partial<SectorUser> = {}): SectorUser =>
  ({
    userId: "other",
    status: "AWAKE",
    rank: "JONIN",
    allianceStatus: "NEUTRAL",
    longitude: 5,
    latitude: 5,
    experience: 0,
    avatar: "avatar.webp",
    avatarLight: "light.webp",
    ...patch,
  }) as SectorUser;
const viewer = {
  userId: "self",
  sector: 724,
  userQuests: [],
  questData: [],
  rank: "JONIN",
} as unknown as NonNullable<UserWithRelations>;
const recipes = (users: SectorUser[], patch: Partial<TravelActorsSnapshot> = {}) =>
  travelActorRecipes({
    grid,
    users,
    viewer,
    sector: 724,
    minBracket: -1,
    showUsers: true,
    friendlyAttack: false,
    structureObjectiveIds: new Set(),
    ...patch,
  });

describe("travel actor snapshots", () => {
  it("shows duty copies across brackets with profile information but no combat or healing actions", () => {
    const protector = player({
      userId: "duty:owner",
      isVillageDuty: true,
      villageDutyUserId: "owner",
      rank: "CHUNIN",
      experience: 0,
    });
    const result = recipes([protector], { minBracket: 8 });
    expect(result).toHaveLength(1);
    expect(result[0]?.parts.map((part) => part.kind)).not.toContain("attack");
    expect(result[0]?.parts.map((part) => part.kind)).not.toContain("heal");
    expect(travelActionAvailability(viewer, protector, true, [])).toEqual({
      attack: false,
      heal: false,
      info: true,
    });
    expect(isAloneOnTile([protector, player()], player(), "self")).toBe(true);
  });
  it.each([-1, 2])(
    "keeps the own marker at bracket %s while filtering other players",
    (minBracket) => {
      const result = recipes(
        [
          player({ userId: "self" }),
          player(),
          player({ userId: "matching", longitude: 6, experience: 600_000 }),
        ],
        { minBracket },
      );
      expect(result.some((recipe) => recipe.key === "user:self")).toBe(true);
      expect(result.some((recipe) => recipe.key === "user:other")).toBe(
        minBracket === -1,
      );
      expect(result.some((recipe) => recipe.key === "user:matching")).toBe(true);
    },
  );
  it("keeps only the own marker when active users are hidden", () => {
    expect(
      recipes([player(), player({ userId: "self" })], { showUsers: false }).map(
        (recipe) => recipe.key,
      ),
    ).toEqual(["user:self"]);
  });
  it.each(["FRIENDLY", "HOSTILE"] as const)(
    "keeps independent placement identities for %s NPCs",
    (npcInteractionType) => {
      const result = recipes(
        [
          player({ isNpc: true, npcPlacementId: "one", npcInteractionType }),
          player({ isNpc: true, npcPlacementId: "two", npcInteractionType }),
        ],
        { minBracket: 8 },
      );
      expect(result.map((recipe) => recipe.key)).toEqual([
        "npc:one:0:0",
        "npc:two:0:0",
      ]);
      expect(result[0]?.parts.map((part) => part.kind)).toEqual([
        "avatar",
        npcInteractionType === "HOSTILE" ? "attack" : "talk",
      ]);
      expect(result[0]?.parts[0]).toMatchObject({
        image: "avatar.webp",
        rendition: 256,
      });
    },
  );
  it("animates ambient NPC sheets with shadows, never orbits roaming members and follows the Wildlife setting", () => {
    const sheet = (id: string) => ({
      id,
      name: id,
      url: `https://uploadthing.b-cdn.net/f/${id}`,
      smallUrl: `https://uploadthing.b-cdn.net/f/${id}-small`,
      columns: 8,
      rows: 2,
      frameCount: 16,
      fps: 12.5,
      facing: "left" as const,
    });
    const deer = (member: number) =>
      player({
        userId: "deer",
        isNpc: true,
        npcPlacementId: "herd",
        npcCopy: 2,
        npcMember: member,
        npcInteractionType: "AMBIENT",
        npcScale: 0.5,
        npcWander: {
          seed: "herd:0:2",
          anchor: { x: 5, y: 5 },
          radius: 5,
          wildOnly: true,
        },
        npcSheets: { idle: sheet("idle"), move: sheet("move") },
      });
    const result = recipes([deer(0), deer(1), deer(2)]);
    expect(result.map((recipe) => recipe.key)).toEqual([
      "npc:herd:2:0",
      "npc:herd:2:1",
      "npc:herd:2:2",
    ]);
    expect(result.every((recipe) => !recipe.spread)).toBe(true);
    const parts = result[0]!.parts;
    expect(parts.map((part) => part.kind)).toEqual(["avatar"]);
    expect(parts[0]).toMatchObject({
      shadow: expect.any(Number),
      size: 10 * 1.3 * 0.5,
    });
    // Wildlife casts shadows but carries no night light pool.
    expect(parts[0]).not.toHaveProperty("light");
    // Members sharing a sheet idle out of step.
    const loops = result.map((recipe) => recipe.parts[0]?.loop);
    expect(new Set(loops.map((loop) => loop?.offsetMs)).size).toBe(3);
    expect(
      new Set(loops.map((loop) => loop?.clip.frameDurationMs)).size,
    ).toBeGreaterThan(1);
    expect(parts[0]?.loop).toMatchObject({
      facing: "left",
      clip: { images: ["https://uploadthing.b-cdn.net/f/idle"] },
    });
    expect(parts[0]?.walk).toMatchObject({
      facing: "left",
      clip: { images: ["https://uploadthing.b-cdn.net/f/move"] },
    });
    expect(
      recipes([deer(0), player()], { showAmbient: false }).map((recipe) => recipe.key),
    ).toEqual(["user:other"]);
  });
  it("omits restricted attack actions while preserving healing and profile details", () => {
    expect(
      recipes([player({ rank: "STUDENT" })])[0]?.parts.map((part) => part.kind),
    ).toEqual(["marker", "marker", "avatar", "heal", "info"]);
  });
  it("tucks player controls in around a character sprite, clear of a wider portrait", () => {
    const controls = (patch: Partial<SectorUser>) =>
      Object.fromEntries(
        recipes([player(patch)])[0]!
          .parts.filter((part) => ["attack", "heal", "info"].includes(part.kind))
          .map((part) => [
            part.kind,
            [Math.round(part.x * 5) / 100, Math.round(part.y * 10) / 100],
          ]),
      );
    const portrait = controls({}),
      sprite = controls({ spriteAppearance: { body: "male", layers: [] } as never });
    expect(portrait).toEqual({ attack: [0.9, 1.4], heal: [1, 0.5], info: [0.1, 1.4] });
    expect(sprite).toEqual({
      attack: [0.79, 1.2],
      heal: [0.8, 0.5],
      info: [0.22, 1.2],
    });
    for (const kind of ["attack", "heal", "info"] as const)
      expect(Math.abs(sprite[kind]![0]! - 0.5)).toBeLessThan(
        Math.abs(portrait[kind]![0]! - 0.5),
      );
  });
  it("preserves solo PvE battle pins and adds a second portrait when available", () => {
    const solo = recipes([player({ status: "BATTLE", battleId: "battle" })]);
    const pair = recipes([
      player({ status: "BATTLE", battleId: "battle" }),
      player({ userId: "foe", status: "BATTLE", battleId: "battle" }),
    ]);
    expect(solo[0]?.battleId).toBe("battle");
    expect(solo[0]?.parts.some((part) => part.image === IMG_SECTOR_VS_ICON)).toBe(true);
    expect(pair[0]?.parts.length).toBe((solo[0]?.parts.length ?? 0) + 1);
  });
  it("keeps the creator's tile clear of battle pins so challengers can always reach them", () => {
    const creator = player({
      userId: "creator",
      username: CREATOR_USERNAME,
      rank: "STUDENT",
    });
    const challenger = player({
      userId: "challenger",
      status: "BATTLE",
      battleId: "trial",
    });
    const result = recipes([creator, challenger]);
    expect(result.map((recipe) => recipe.key)).toEqual(["user:creator"]);
    expect(result[0]?.parts.some((part) => part.kind === "attack")).toBe(true);
  });
  it("draws full-body art in place of the layered character, for the viewer too", () => {
    const appearance = { bodyStyle: "male" } as never;
    for (const userId of ["creator", "self"]) {
      const creator = player({
        userId,
        username: CREATOR_USERNAME,
        bodyArt: "robot.webp",
        spriteAppearance: appearance,
      });
      const [recipe] = recipes([creator]);
      expect(recipe?.user?.spriteAppearance).toBeUndefined();
      expect(recipe?.parts.some((part) => part.kind === "marker")).toBe(false);
      const body = recipe?.parts.find((part) => part.kind === "avatar");
      // Twice an NPC's height on the 10px test tile, from the native source, sampled smoothly.
      expect(body).toMatchObject({
        image: "robot.webp",
        rendition: 0,
        nearest: false,
        size: 26,
      });
      expect(body).not.toHaveProperty("character");
      // Grounded and lit as players are, still when no idle sheet is bound.
      expect(body).toMatchObject({ shadow: 0.16, light: 0.65 });
      expect(body?.loop).toBeUndefined();
    }
  });
  it("loops the body art's idle sheet, and its walk while moving, from full-size cells", () => {
    const sheet = (id: string, rows: number, facing: "left" | "right") => ({
      id,
      name: id,
      url: `https://example.com/${id}.png`,
      smallUrl: `https://example.com/${id}-small.png`,
      columns: 8,
      rows,
      frameCount: rows * 8,
      fps: 12.5,
      facing,
    });
    const [recipe] = recipes([
      player({
        username: CREATOR_USERNAME,
        bodyArt: "robot.webp",
        bodyIdle: sheet("idle", 3, "left"),
        bodyMove: sheet("move", 2, "right"),
      }),
    ]);
    const body = recipe?.parts.find((part) => part.kind === "avatar");
    const clip = (id: string, rows: number) => ({
      images: [`https://example.com/${id}.png`],
      columns: 8,
      rows,
      frameCount: rows * 8,
      frameDurationMs: 80,
      loop: true,
    });
    expect(body?.loop).toEqual({ clip: clip("idle", 3), facing: "left" });
    // The walk keeps its own facing, so it mirrors independently of the idle sheet.
    expect(body?.walk).toEqual({ clip: clip("move", 2), facing: "right" });
  });
  it("still pins a battle beside an ordinary player, and once the creator has left the tile", () => {
    const challenger = player({
      userId: "challenger",
      status: "BATTLE",
      battleId: "fight",
    });
    expect(
      recipes([player(), challenger]).some((recipe) => recipe.battleId === "fight"),
    ).toBe(true);
    const fighting = player({
      userId: "creator",
      username: CREATOR_USERNAME,
      status: "BATTLE",
      battleId: "own",
    });
    expect(
      recipes([fighting, challenger]).filter((recipe) => recipe.battleId).length,
    ).toBe(2);
  });
  it("counts only awake players, not fighters or NPCs, when judging a tile alone", () => {
    const target = player();
    expect(
      isAloneOnTile(
        [
          target,
          player({ userId: "fighter", status: "BATTLE" }),
          player({ userId: "npc", isNpc: true }),
          player({ userId: "self" }),
        ],
        target,
        "self",
      ),
    ).toBe(true);
    expect(isAloneOnTile([target, player({ userId: "two" })], target, "self")).toBe(
      false,
    );
  });
  it("keeps the viewer and NPC placements while representing crowded players with a count", () => {
    const result = recipes([
      player(),
      player({ userId: "two" }),
      player({ userId: "self" }),
      player({ isNpc: true, npcPlacementId: "guide" }),
    ]);
    expect(
      result.filter((recipe) => recipe.counter).map((recipe) => recipe.counter),
    ).toEqual([4]);
    expect(result.filter((recipe) => recipe.user).map((recipe) => recipe.key)).toEqual([
      "user:other",
      "user:two",
      "user:self",
      "npc:guide:0:0",
    ]);
    expect(
      result.filter((recipe) => recipe.user).every((recipe) => recipe.spread),
    ).toBe(true);
  });
  it("never exposes self actions or a masked profile", () => {
    expect(
      travelActionAvailability(viewer, player({ userId: "self" }), true, null),
    ).toEqual({ attack: false, heal: false, info: false });
    expect(
      travelActionAvailability(viewer, player({ isMasked: true }), false, null).info,
    ).toBe(false);
  });
});
