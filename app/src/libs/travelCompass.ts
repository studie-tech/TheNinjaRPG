import { MAP_WORLD_COLUMNS } from "@/drizzle/constants";
import { isValidSectorId } from "@/libs/sector-map/sector-ids";
import { sectorGridPosition } from "@/libs/sector-map/world-grid";

export type CompassDestination =
  | { type: "home" }
  | { type: "village"; villageId: string }
  | { type: "sector"; sector: number };

/** Restore only recognized compass choices; malformed browser storage defaults to home. */
export const parseCompassDestination = (stored: unknown): CompassDestination => {
  if (stored && typeof stored === "object") {
    if (
      "type" in stored &&
      stored.type === "village" &&
      "villageId" in stored &&
      typeof stored.villageId === "string" &&
      stored.villageId
    ) {
      return { type: "village", villageId: stored.villageId };
    }
    if (
      "type" in stored &&
      stored.type === "sector" &&
      "sector" in stored &&
      typeof stored.sector === "number" &&
      isValidSectorId(stored.sector)
    ) {
      return { type: "sector", sector: stored.sector };
    }
  }
  return { type: "home" };
};

/** Screen-space bearing toward a sector, using the world's shortest wrapped longitude. */
export const getSectorCompassBearing = (fromSector: number, toSector: number) => {
  const from = sectorGridPosition(fromSector);
  const to = sectorGridPosition(toSector);
  if (!from || !to) return null;
  const east =
    ((to.column - from.column + MAP_WORLD_COLUMNS * 1.5) % MAP_WORLD_COLUMNS) -
    MAP_WORLD_COLUMNS / 2;
  const south = to.row - from.row;
  const angle = ((Math.atan2(east, -south) * 180) / Math.PI + 360) % 360;
  const directions = [
    "north",
    "northeast",
    "east",
    "southeast",
    "south",
    "southwest",
    "west",
    "northwest",
  ] as const;
  return {
    angle,
    direction: directions[Math.round(angle / 45) % directions.length] ?? "north",
    arrived: fromSector === toSector,
  };
};
