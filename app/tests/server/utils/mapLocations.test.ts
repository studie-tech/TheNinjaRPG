import { afterEach, expect, it, vi } from "bun:test";
import type { DrizzleClient } from "@/server/db";
import {
  fetchPublicQuestLocations,
  validateMapLocationTiles,
} from "@/server/utils/mapLocations";
import { MoveToObjective } from "@/validators/objectives";

afterEach(() => vi.restoreAllMocks());

it("refetches when a remote edit happened during the cached read", async () => {
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const findMany = vi
    .fn()
    .mockImplementationOnce(async () => {
      // The snapshot predates the remote edit at 2000, but its response arrives later.
      now = 3000;
      return [
        {
          id: "public",
          hidden: false,
          startsAt: null,
          endsAt: null,
          content: {
            objectives: [
              MoveToObjective.parse({
                id: "tower",
                task: "move_to_location",
                sector: 724,
                longitude: 3,
                latitude: 4,
                structureAssetId: "asset",
                locationName: "Tower",
                locationDescription: "An old tower.",
              }),
            ],
          },
        },
      ];
    })
    .mockResolvedValue([]);
  const client = { query: { quest: { findMany } } } as unknown as DrizzleClient;

  expect(await fetchPublicQuestLocations(client)).toHaveLength(1);
  expect(await fetchPublicQuestLocations(client, { revision: 2000 })).toEqual([]);
  expect(findMany).toHaveBeenCalledTimes(2);
});

it("rejects a map that moves a public entrance away from its visible structure", () => {
  // A smaller published map must not relocate an authored entrance onto another tile.
  const locations = [
    {
      id: "tower",
      sector: 724,
      longitude: 2,
      latitude: 0,
      assetId: "asset",
      name: "Tower",
      description: "",
      scale: 1,
    },
  ];
  const map = {
    width: 2,
    height: 1,
    anchors: [],
    tiles: [
      {
        x: 0,
        y: 0,
        blocked: true,
        walkCost: 0,
        terrain: "ground",
        battleBiome: "ground",
        zone: "wilderness",
      },
      {
        x: 1,
        y: 0,
        blocked: false,
        walkCost: 1,
        terrain: "ground",
        battleBiome: "ground",
        zone: "wilderness",
      },
    ],
  };
  expect(validateMapLocationTiles(locations, new Map([[724, map as never]]))).toContain(
    "reachable entrance tile",
  );
});
