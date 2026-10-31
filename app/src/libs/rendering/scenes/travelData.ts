import type { TravelWindowEntry } from "@/libs/rendering/scenes/travel";
import type { MapLocation } from "@/validators/mapLocation";

/** Window position and generated structure timestamps do not change sector artwork. */
export const travelSectorKey = (
  entry: TravelWindowEntry,
  libraryVersion: string,
  lightLayout: boolean,
  locations: MapLocation[],
  foundations?: ReadonlySet<string>,
) =>
  JSON.stringify([
    entry.sector,
    entry.map,
    entry.villageType,
    entry.globalTileType,
    entry.structures.map((structure) => [
      structure.id,
      structure.image,
      structure.longitude,
      structure.latitude,
      structure.hasPage,
    ]),
    libraryVersion,
    lightLayout,
    locations,
    foundations ? [...foundations].sort() : [],
  ]);
