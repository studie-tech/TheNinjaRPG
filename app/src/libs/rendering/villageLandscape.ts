import { type Grid, ring } from "honeycomb-grid";
import type { VillageStructure } from "@/drizzle/schema";
import { PathCalculator, type TerrainHex } from "@/libs/hexgrid";
import {
  getWorldForecourtPoint,
  getWorldStructureEntrance,
  resolveWorldStructure,
} from "@/libs/rendering/worldStructures";
import {
  getVillageWallFoundationKeys,
  type VillageWallPlan,
} from "@/libs/sector-map/village-walls";

/** Retain authored streets and connect service entrances and gates, preferring dry ground to boardwalks. */
export const planVillageLandscape = (
  grid: Grid<TerrainHex>,
  structures: VillageStructure[],
  wall: VillageWallPlan | null,
) => {
  const roads = new Set(
    grid
      .toArray()
      .filter((tile) => tile.zone === "road" && !tile.spec?.isWater)
      .map((tile) => `${tile.col},${tile.row}`),
  );
  const services = structures
    .filter(
      (structure) =>
        structure.hasPage &&
        resolveWorldStructure(structure.image, structure.route, structure.worldArt),
    )
    .sort((a, b) => a.route.localeCompare(b.route));
  const tiles = grid.toArray();
  const maxCol = Math.max(...tiles.map((tile) => tile.col)),
    maxRow = Math.max(...tiles.map((tile) => tile.row));
  // Sparse roadside settlements connect the existing trailheads to their landmark.
  const trailheads =
    services.length < 2 && roads.size < tiles.length * 0.3
      ? [
          tiles.find((tile) => tile.col === 0 && roads.has(`${tile.col},${tile.row}`)),
          tiles.find(
            (tile) => tile.col === maxCol && roads.has(`${tile.col},${tile.row}`),
          ),
          tiles.find((tile) => tile.row === 0 && roads.has(`${tile.col},${tile.row}`)),
          tiles.find(
            (tile) => tile.row === maxRow && roads.has(`${tile.col},${tile.row}`),
          ),
        ].flatMap((tile) => (tile ? [{ longitude: tile.col, latitude: tile.row }] : []))
      : [];
  const gates =
    wall?.edges
      .filter((edge) => edge.kind === "gate")
      .map((edge) => ({ longitude: edge.tile.x, latitude: edge.tile.y })) ?? [];
  const entrances = services.flatMap((site) => {
    const tile = grid.getHex({ col: site.longitude, row: site.latitude });
    if (!tile) return [];
    const art = resolveWorldStructure(site.image, site.route, site.worldArt);
    if (!art) return [];
    const entrance = getWorldStructureEntrance(tile, tile.height * art.height, art);
    const [x, y] = getWorldForecourtPoint(entrance, 0, tile.height * 0.7);
    const landing = grid.pointToHex({ x, y }) ?? tile;
    return [{ longitude: landing.col, latitude: landing.row }];
  });
  const sites = [...entrances, ...gates, ...trailheads].flatMap((site) => {
    const tile = grid.getHex({ col: site.longitude, row: site.latitude });
    return tile ? [tile] : [];
  });
  // Every authored street component joins the service network, including lanes beyond a doorway's route.
  const remainingRoads = new Set(roads);
  while (remainingRoads.size) {
    const key = remainingRoads.values().next().value;
    const seed = tiles.find((tile) => `${tile.col},${tile.row}` === key);
    if (!seed || !key) break;
    remainingRoads.delete(key);
    const component = [seed];
    for (let index = 0; index < component.length; index++) {
      const center = component[index];
      if (!center) continue;
      for (const tile of grid.traverse(ring({ center, radius: 1 })))
        if (remainingRoads.delete(`${tile.col},${tile.row}`)) component.push(tile);
    }
    const distance = (tile: TerrainHex) =>
      sites.reduce(
        (nearest, site) => Math.min(nearest, grid.distance(tile, site)),
        Infinity,
      );
    sites.push(
      component.reduce(
        (nearest, tile) => (distance(tile) < distance(nearest) ? tile : nearest),
        seed,
      ),
    );
  }
  if (sites.length < 2) return roads;
  const foundation = wall ? getVillageWallFoundationKeys(wall) : new Set<string>();
  const buildingCores = new Set(
    services.map((site) => `${site.longitude},${site.latitude}`),
  );
  const landings = new Set(sites.map((tile) => `${tile.col},${tile.row}`));
  // Clone hexes before assigning landscape costs: paths never alter movement, battle biomes or map JSON.
  const landscape = grid.map((tile) =>
    Object.assign(tile.clone<TerrainHex>(), {
      spec: tile.spec,
      cost: roads.has(`${tile.col},${tile.row}`)
        ? 1
        : tile.spec?.isWater
          ? 100
          : tile.hasStructure
            ? 2
            : 3,
      blocked:
        (buildingCores.has(`${tile.col},${tile.row}`) &&
          !landings.has(`${tile.col},${tile.row}`)) ||
        (foundation.has(`${tile.col},${tile.row}`) && tile.zone !== "road"),
    }),
  );
  const connected = sites.splice(0, 1);
  while (sites.length) {
    let best = { index: 0, from: connected[0], distance: Infinity };
    for (const from of connected)
      sites.forEach((site, index) => {
        const distance = grid.distance(from, site);
        if (distance < best.distance) best = { index, from, distance };
      });
    const site = sites.splice(best.index, 1)[0];
    if (!site || !best.from) break;
    const from = landscape.getHex(best.from),
      to = landscape.getHex(site);
    // Rebuild after each cheaper road so A*'s cached lower bound remains valid.
    const path =
      from && to ? new PathCalculator(landscape).getShortestPath(from, to) : undefined;
    for (const tile of path ?? []) {
      roads.add(`${tile.col},${tile.row}`);
      tile.cost = 1;
    }
    connected.push(site);
  }
  return roads;
};

/** Narrow ground-plane paths share their geometry with scenery clearance; full hexes retain their terrain. */
export const getVillageRoadLayout = (
  grid: Grid<TerrainHex>,
  roads: ReadonlySet<string>,
) => {
  const nodes = grid
    .toArray()
    .filter((tile) => roads.has(`${tile.col},${tile.row}`))
    .map((tile) => {
      const neighbors = [...grid.traverse(ring({ center: tile, radius: 1 }))].filter(
        (neighbor) =>
          roads.has(`${neighbor.col},${neighbor.row}`) &&
          !!neighbor.spec?.isWater === !!tile.spec?.isWater,
      );
      // Adjacent authored lanes converge into one path rather than drawing a ladder of hex links.
      const nearWater = [...grid.traverse(ring({ center: tile, radius: 1 }))].some(
        (neighbor) => neighbor.spec?.isWater,
      );
      const points = neighbors.length > 2 && !nearWater ? [tile, ...neighbors] : [tile];
      return {
        tile,
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
        bridge: !!tile.spec?.isWater,
      };
    });
  const byKey = new Map(
    nodes.map((node) => [`${node.tile.col},${node.tile.row}`, node]),
  );
  const segments = nodes.flatMap((a) =>
    [...grid.traverse(ring({ center: a.tile, radius: 1 }))].flatMap((tile) => {
      const b = byKey.get(`${tile.col},${tile.row}`);
      if (
        !b ||
        a.tile.col > tile.col ||
        (a.tile.col === tile.col && a.tile.row >= tile.row)
      )
        return [];
      const dx = b.x - a.x,
        dy = (b.y - a.y) * 2,
        length = Math.hypot(dx, dy);
      if (length < 0.1) return [];
      const px = (-dy / length) * a.tile.width * 0.18,
        py = (dx / length) * a.tile.width * 0.09;
      // Check both edges, so a dirt shoulder cannot cut across a concave water bank.
      const bridge = [0, 0.25, 0.5, 0.75, 1].some((t) =>
        [-1, 0, 1].some(
          (side) =>
            grid.pointToHex({
              x: a.x + dx * t + px * side,
              y: a.y + (b.y - a.y) * t + py * side,
            })?.spec?.isWater,
        ),
      );
      return [{ a, b, bridge, halfWidth: a.tile.width * (bridge ? 0.18 : 0.16) }];
    }),
  );
  for (const node of nodes)
    node.bridge ||= Array.from({ length: 8 }, (_, index) => (index * Math.PI) / 4).some(
      (angle) =>
        grid.pointToHex({
          x: node.x + Math.cos(angle) * node.tile.width * 0.18,
          y: node.y + Math.sin(angle) * node.tile.width * 0.09,
        })?.spec?.isWater,
    );
  for (const segment of segments)
    if (segment.bridge) segment.a.bridge = segment.b.bridge = true;
  return { nodes, segments };
};

/** Scenery clears the actual path width, leaving vegetation visible beside a narrow route. */
export const isOnVillageRoad = (
  point: { x: number; y: number },
  layout: ReturnType<typeof getVillageRoadLayout>,
  padding = 0,
) =>
  layout.nodes.some(
    (node) =>
      Math.hypot(point.x - node.x, (point.y - node.y) * 2) <
      node.tile.width * (node.bridge ? 0.18 : 0.16) + padding,
  ) ||
  layout.segments.some(({ a, b, halfWidth }) => {
    const dx = b.x - a.x,
      dy = (b.y - a.y) * 2;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - a.x) * dx + (point.y - a.y) * 2 * dy) / (dx * dx + dy * dy),
      ),
    );
    return (
      Math.hypot(point.x - a.x - dx * t, (point.y - a.y) * 2 - dy * t) <
      halfWidth + padding
    );
  });
