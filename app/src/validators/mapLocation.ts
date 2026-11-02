import { z } from "zod";

/** Presentation is independent of quest portraits and objective completion. */
export const mapLocationFields = {
  structureAssetId: z.string().max(191).prefault(""),
  locationName: z.string().trim().max(100).prefault(""),
  locationDescription: z.string().trim().max(2000).prefault(""),
  structureScale: z.coerce.number().min(0.2).max(5).prefault(1),
};

export const STRUCTURE_OBJECTIVE_TASKS = [
  "move_to_location",
  "collect_item",
  "deliver_item",
  "defeat_opponents",
  "dialog",
] as const;

/** Only objectives with a location interaction can author structure presentation. */
export const supportsMapStructure = (task: string) =>
  (STRUCTURE_OBJECTIVE_TASKS as readonly string[]).includes(task);

/** Shared refresh cadence for independently cached artwork and public landmarks. */
export const MAP_LOCATION_REFRESH_MS = 10_000;
/** Neutral presentation shared by player and editor rendering, without quest mechanics or progress. */
export interface MapLocation {
  id: string;
  questId?: string;
  objectiveId?: string;
  npcPlacementId?: string;
  sector: number;
  longitude: number;
  latitude: number;
  name: string;
  description: string;
  assetId: string;
  scale: number;
  /** Derived from the viewer's available objective; never granted by the public projection. */
  active?: boolean;
}
