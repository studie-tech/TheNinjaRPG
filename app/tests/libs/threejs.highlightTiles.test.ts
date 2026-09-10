import { Grid, rectangle } from "honeycomb-grid";
import { Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineHex } from "@/libs/hexgrid";
import { highlightTiles } from "@/libs/threejs/combat";

// Bun has no DOM; the renderer only needs the body cursor in these tests.
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
beforeEach(() => {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { body: { style: { cursor: "default" } } },
  });
});
afterEach(() => {
  if (originalDocument) {
    Object.defineProperty(globalThis, "document", originalDocument);
  } else {
    Reflect.deleteProperty(globalThis, "document");
  }
});

type HighlightInfo = Parameters<typeof highlightTiles>[0];

const createScene = () => {
  const grid = new Grid(defineHex(), rectangle({ width: 3, height: 3 }));
  const group_tiles = new Group();
  const meshes = Array.from(grid, (tile) => {
    const mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ color: "white" }),
    );
    mesh.name = `${tile.row},${tile.col}`;
    mesh.userData = {
      tile,
      originalColor: mesh.material.color.clone(),
      highlight: false,
      selected: false,
      canClick: false,
    };
    group_tiles.add(mesh);
    return mesh;
  });
  const user = {
    userId: "user-1",
    longitude: 0,
    latitude: 0,
    curHealth: 100,
    maxHealth: 100,
    actionPoints: 100,
    fledBattle: false,
  } as HighlightInfo["user"];
  const action: NonNullable<HighlightInfo["action"]> = {
    id: "wide-range",
    name: "Wide range",
    image: "",
    battleDescription: "",
    type: "basic",
    target: "GROUND",
    method: "SINGLE",
    range: 10,
    healthCost: 0,
    chakraCost: 0,
    staminaCost: 0,
    actionCostPerc: 10,
    updatedAt: 0,
    cooldown: 0,
    originalCooldown: 0,
    effects: [],
  };
  const info: HighlightInfo = {
    group_tiles,
    group_highlight_edges: new Group(),
    grid,
    user,
    battle: {
      version: 1,
      activeUserId: user.userId,
      round: 1,
      roundStartAt: new Date(),
      usersState: [user],
      usersEffects: [],
      groundEffects: [],
    } as unknown as HighlightInfo["battle"],
    action,
    precomputedActions: [action],
    timeDiff: 0,
    cachedIntersections: { battleTiles: [], tiles: [], ground: [] },
    currentHighlights: new Set<string>(),
  };
  const render = () => {
    info.currentHighlights = highlightTiles(info);
    return info.currentHighlights;
  };
  return { info, meshes, render };
};

const rangeColor = new Color("white").lerp(new Color("rgb(80, 80, 80)"), 0.7);

const expectRangeColors = (meshes: Mesh<PlaneGeometry, MeshBasicMaterial>[]) => {
  for (const mesh of meshes) {
    expect(mesh.userData.highlight).toBe(true);
    expect(mesh.material.color.equals(rangeColor)).toBe(true);
  }
};

describe("highlightTiles range colors", () => {
  it("colors newly highlighted tiles before caching the first frame", () => {
    const { meshes, render } = createScene();
    const highlights = render();
    expectRangeColors(meshes);

    // The next frame reuses the completed colors and highlight set.
    expect(render()).toBe(highlights);
    expectRangeColors(meshes);
  });

  it("colors newly added tiles immediately when switching to a wider action", () => {
    const { info, meshes, render } = createScene();
    const wideAction = info.action;
    info.action = {
      ...wideAction,
      id: "origin-only",
      method: "SINGLE",
      range: 0,
    } as HighlightInfo["action"];
    expect(render().size).toBe(1);

    info.action = wideAction;
    expect(render().size).toBe(meshes.length);
    expectRangeColors(meshes);
  });

  it("preserves selected colors above range tint on the first frame", () => {
    const { info, meshes, render } = createScene();
    const selected = meshes[0]!;
    info.cachedIntersections.battleTiles = [
      { object: selected, distance: 0, point: new Vector3() },
    ];
    render();
    const selectedColor = new Color("white").lerp(new Color("rgb(0, 255, 100)"), 0.8);
    expect(selected.material.color.equals(selectedColor)).toBe(true);
    expect(selected.userData.canClick).toBe(true);
    expectRangeColors(meshes.slice(1));

    info.cachedIntersections.battleTiles = [];
    render();
    expectRangeColors(meshes);
    expect(selected.userData.selected).toBe(false);
    expect(selected.userData.canClick).toBe(false);
  });

  it("restores original colors and hides edges when the action is deselected", () => {
    const { info, meshes, render } = createScene();
    render();
    info.action = undefined;
    expect(render().size).toBe(0);
    for (const mesh of meshes) {
      expect(mesh.userData.highlight).toBe(false);
      expect(mesh.material.color.equals(mesh.userData.originalColor)).toBe(true);
    }
    expect(info.group_highlight_edges.children.every((edge) => !edge.visible)).toBe(true);
  });
});
