import { describe, expect, it } from "bun:test";
import {
  ARRIVAL_PUP_AI_ID,
  BLACKSTEEL_COURIER_AI_ID,
  BLACKSTEEL_DOUBLE_AI_ID,
  BLACKSTEEL_PROCTOR_AI_ID,
} from "@/drizzle/constants";
import { oddQHexDistance } from "@/libs/hexgrid";
import { travelActorKey } from "@/libs/rendering/scenes/travelActors";
import { getNeighborCoordinates } from "@/libs/sector-map/validation";
import { isStoryPlacementId } from "@/libs/storyActors";
import {
  npcWalkPose,
  planStoryMeeting,
  planStoryScene,
  type StoryScene,
  type StorySceneKind,
  storyRoleKey,
  storySceneActors,
} from "@/libs/storyScene";

type Tile = { x: number; y: number };

const SIZE = 30;
const player = { x: 14, y: 14 };
const onMap = (tile: Tile) =>
  tile.x >= 0 && tile.y >= 0 && tile.x < SIZE && tile.y < SIZE;
const distance = (a: Tile, b: Tile) => oddQHexDistance(a.x, a.y, b.x, b.y);
const START = 1_000_000;

const plan = (
  kind: Exclude<StorySceneKind, "meeting">,
  overrides: Partial<Parameters<typeof planStoryScene>[0]> = {},
) =>
  planStoryScene({
    kind,
    player,
    isOpen: onMap,
    isCovered: () => false,
    startAt: START,
    ...overrides,
  });

const staged = (...args: Parameters<typeof plan>): StoryScene => {
  const scene = plan(...args);
  if (!scene) throw new Error("expected a scene");
  return scene;
};

const standingOf = (scene: StoryScene, role: string) =>
  scene.cast.find((entry) => entry.role === role)?.walk.tiles.at(-1) as Tile;

const art = Object.fromEntries(
  [ARRIVAL_PUP_AI_ID, BLACKSTEEL_COURIER_AI_ID, BLACKSTEEL_DOUBLE_AI_ID].map((id) => [
    id,
    { avatar: `${id}.webp` },
  ]),
);
const namesAt = (scene: StoryScene, elapsed: number) =>
  storySceneActors(scene, elapsed, art, 301).map((actor) => actor.userId);

describe("planStoryScene", () => {
  it("greets with Lemu a short walk away and points at the ground beside her", () => {
    const scene = staged("greeting");
    const lemu = standingOf(scene, "lemu");
    expect(distance(lemu, player)).toBe(3);
    expect(distance(scene.marker, player)).toBe(2);
    expect(distance(scene.marker, lemu)).toBe(1);
  });

  it("stands its figures where no scenery covers them", () => {
    const isCovered = (tile: Tile) => tile.x !== player.x;
    const scene = staged("greeting", { isCovered });
    expect(isCovered(standingOf(scene, "lemu"))).toBe(false);
  });

  it("leaves the double two tiles away, to the east, with Lemu on the player's other side", () => {
    const scene = staged("ambush");
    const double = standingOf(scene, "double");
    const lemu = standingOf(scene, "lemu");
    expect(distance(double, player)).toBe(2);
    expect(double.x).toBeGreaterThan(player.x);
    expect(distance(lemu, player)).toBe(1);
    expect(distance(lemu, double)).toBeGreaterThanOrEqual(2);
    expect(scene.marker).toEqual(double);
  });

  it("runs the chase step by step past the player, never through them or Lemu", () => {
    const scene = staged("ambush");
    const lemu = standingOf(scene, "lemu");
    for (const { role, walk } of scene.cast) {
      if (role === "lemu") continue;
      walk.tiles.slice(1).forEach((tile, index) => {
        expect(getNeighborCoordinates(walk.tiles[index] as Tile)).toContainEqual(tile);
      });
      for (const tile of walk.tiles) {
        expect(tile).not.toEqual(player);
        expect(tile).not.toEqual(lemu);
      }
    }
    const pup = scene.cast.find((entry) => entry.role === "pup")?.walk.tiles ?? [];
    expect(pup[0]?.x).toBeGreaterThan(player.x + 5);
    expect(pup.at(-1)?.x).toBeLessThan(player.x - 5);
  });

  it("walks Lemu over from where she greeted the player", () => {
    const scene = staged("ambush", { previousLemu: { x: 10, y: 14 } });
    const walk = scene.cast.find((entry) => entry.role === "lemu")?.walk.tiles ?? [];
    expect(walk[0]).toEqual({ x: 10, y: 14 });
    expect(distance(walk.at(-1) as Tile, player)).toBe(1);
  });

  it("waits for a rematch with Lemu and the double alone", () => {
    expect(staged("standoff").cast.map((entry) => entry.role)).toEqual([
      "lemu",
      "double",
    ]);
  });

  it("stages nothing without the room for it", () => {
    for (const kind of ["greeting", "ambush", "standoff"] as const)
      expect(plan(kind, { isOpen: (tile) => distance(tile, player) === 0 })).toBe(
        undefined,
      );
  });
});

describe("storySceneActors", () => {
  const scene = staged("ambush");

  it("brings the double out of the smoke and lets the hunter go", () => {
    expect(namesAt(scene, 0)).toEqual(["story-lemu", "story-pup", "story-courier"]);
    expect(namesAt(scene, scene.smokeAt + 400)).toContain("story-double");
    expect(namesAt(scene, scene.smokeAt + 400)).toContain("story-courier");
    expect(namesAt(scene, 60_000)).toEqual(["story-lemu", "story-double"]);
  });

  it("lets the player answer once the double stands there", () => {
    expect(namesAt(scene, scene.endsAt)).toContain("story-double");
    expect(scene.endsAt).toBeGreaterThan(scene.smokeAt);
  });

  it("anchors every figure where the scene happens, as scenery without controls", () => {
    for (const actor of storySceneActors(scene, 0, art, 301)) {
      expect({ x: actor.longitude, y: actor.latitude }).toEqual(scene.marker);
      expect(actor.isStoryActor).toBe(true);
      expect(actor.npcInteractionType).toBe("AMBIENT");
      expect(actor.sector).toBe(301);
    }
  });

  it("gives a figure the map's own control when the scene says so", () => {
    const actors = storySceneActors(scene, 60_000, art, 301, { double: "HOSTILE" });
    expect(
      actors.map((actor) => [actor.npcPlacementId, actor.npcInteractionType]),
    ).toEqual([
      ["story-lemu", "AMBIENT"],
      ["story-double", "HOSTILE"],
    ]);
    expect(actors.every((actor) => isStoryPlacementId(actor.npcPlacementId))).toBe(
      true,
    );
    expect(isStoryPlacementId("placement-1")).toBe(false);
  });

  it("leaves out a figure whose artwork did not load", () => {
    const actors = storySceneActors(scene, 60_000, {}, 301);
    expect(actors.map((actor) => actor.userId)).toEqual(["story-lemu"]);
  });
});

describe("what the figures say", () => {
  const linesAt = (scene: StoryScene, elapsed: number) =>
    scene.lines
      .filter((line) => elapsed >= line.from && elapsed < line.until)
      .map((line) => line.id);

  it("has Lemu greet, then warn, then call for the answer once it can be given", () => {
    expect(linesAt(staged("greeting"), 0)).toEqual(["greeting"]);
    const scene = staged("ambush");
    expect(linesAt(scene, 1000)).toContain("warning");
    expect(linesAt(scene, scene.endsAt)).toEqual(["challenge"]);
    expect(linesAt(staged("standoff"), 0)).toEqual(["challenge"]);
  });

  it("has the hunter order the double while they stand together", () => {
    const scene = staged("ambush");
    expect(linesAt(scene, scene.smokeAt)).toEqual(["order"]);
  });

  it("holds each line to a figure that is on the map while it is said", () => {
    const scene = staged("ambush");
    for (const line of scene.lines) {
      const at = Number.isFinite(line.until) ? (line.from + line.until) / 2 : line.from;
      const keys = storySceneActors(scene, at, art, 301).map(travelActorKey);
      expect(keys).toContain(storyRoleKey(line.role));
    }
  });
});

describe("planStoryMeeting", () => {
  const meet = (isCovered: (tile: Tile) => boolean = () => false, isOpen = onMap) =>
    planStoryMeeting({
      cast: ["proctor", "clone"],
      player,
      isOpen,
      isCovered,
      startAt: START,
    });

  it("stands the speaker two tiles away and the rest beside them, off the player's tile", () => {
    const scene = meet();
    if (!scene) throw new Error("expected a scene");
    const proctor = standingOf(scene, "proctor");
    const clone = standingOf(scene, "clone");
    expect(distance(proctor, player)).toBe(2);
    expect(distance(clone, proctor)).toBe(1);
    expect(clone).not.toEqual(player);
    expect(clone.x).not.toBe(proctor.x);
    expect(scene.lines.map((line) => line.role)).toEqual(["proctor"]);
  });

  it("stands where no scenery covers them, nearer or farther if need be", () => {
    const isCovered = (tile: Tile) => distance(tile, player) === 2;
    const scene = meet(isCovered);
    if (!scene) throw new Error("expected a scene");
    expect(isCovered(standingOf(scene, "proctor"))).toBe(false);
    expect(isCovered(standingOf(scene, "clone"))).toBe(false);
  });

  it("has no scene without open ground", () => {
    expect(meet(undefined, () => false)).toBeUndefined();
  });

  it("gives the figure to talk to its control and leaves the rest as scenery", () => {
    const scene = meet();
    if (!scene) throw new Error("expected a scene");
    const actors = storySceneActors(
      scene,
      0,
      { [BLACKSTEEL_PROCTOR_AI_ID]: { avatar: "proctor.webp" } },
      222,
      { proctor: "FRIENDLY" },
    );
    expect(
      actors.map(({ username, npcInteractionType }) => [username, npcInteractionType]),
    ).toEqual([
      ["Proctor", "FRIENDLY"],
      ["Proctor's clone", "AMBIENT"],
    ]);
  });
});

describe("npcWalkPose", () => {
  const walk = {
    tiles: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ],
    startAt: 100,
    stepMs: 50,
  };

  it("stands on the first tile until the walk starts and on the last one after", () => {
    expect(npcWalkPose(walk, 0)).toMatchObject({ from: { x: 0 }, progress: 0 });
    expect(npcWalkPose(walk, 0)?.isMoving).toBe(false);
    expect(npcWalkPose(walk, 10_000)).toMatchObject({ to: { x: 2 }, progress: 1 });
    expect(npcWalkPose(walk, 10_000)?.isMoving).toBe(false);
  });

  it("moves between the tiles of the step under way", () => {
    expect(npcWalkPose(walk, 175)).toEqual({
      from: { x: 1, y: 0 },
      to: { x: 2, y: 0 },
      progress: 0.5,
      isMoving: true,
    });
  });

  it("stands a figure with a single tile on it", () => {
    expect(
      npcWalkPose({ tiles: [{ x: 4, y: 5 }], startAt: 0, stepMs: 1 }, 99),
    ).toMatchObject({ from: { x: 4, y: 5 }, progress: 0, isMoving: false });
  });
});
