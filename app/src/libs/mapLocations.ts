import { SECTOR_MAP_MAX_DIMENSION } from "@/drizzle/constants";
import type { Quest, UserData, UserQuest } from "@/drizzle/schema";
import { findCompletedPredecessor, isQuestObjectiveAvailable } from "@/libs/objectives";
import { isValidSectorId } from "@/libs/sector-map/sector-ids";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { getUtcDayKey } from "@/utils/time";
import type { MapLocation } from "@/validators/mapLocation";
import { mapLocationFields } from "@/validators/mapLocation";
import type { AllObjectivesType, QuestTrackerType } from "@/validators/objectives";

/** Cosmetic map and designer edits preserve accepted quest runs. */
export const isQuestPresentationOnlyChange = <
  T extends {
    hidden: boolean;
    publicLocations: boolean;
    content: { objectives: AllObjectivesType[] };
  },
>(
  before: T,
  after: T,
) => {
  const comparable = (value: T) => ({
    ...value,
    hidden: false,
    publicLocations: false,
    content: {
      ...value.content,
      nodePositions: undefined,
      objectives: value.content.objectives.map((objective) => {
        const fields = new Set(Object.keys(mapLocationFields));
        return Object.fromEntries(
          Object.entries(objective).filter(([key]) => !fields.has(key)),
        );
      }),
    },
  });
  return calculateContentDiff(comparable(before), comparable(after)).length === 0;
};

/** Stable artwork identity lets an active quest enrich public scenery without duplicating it. */
export const questLocationId = (questId: string, objectiveId: string) =>
  `quest:${questId}:${objectiveId}`;

/** Only neutral location presentation crosses the public boundary. */
export const publicQuestLocations = (
  quests: (Pick<Quest, "id" | "hidden" | "startsAt" | "endsAt"> & {
    content: { objectives: AllObjectivesType[] };
  })[],
  now = new Date(),
): MapLocation[] => {
  const today = getUtcDayKey(now);
  return quests.flatMap((quest) => {
    if (
      quest.hidden ||
      (quest.startsAt && quest.startsAt > today) ||
      (quest.endsAt && quest.endsAt <= today)
    )
      return [];
    return quest.content.objectives.flatMap((objective) => {
      if (
        !objective.structureAssetId ||
        !("sectorType" in objective) ||
        objective.sectorType !== "specific" ||
        !("locationType" in objective) ||
        objective.locationType !== "specific" ||
        objective.hideLocation ||
        objective.overworldPlacementId
      )
        return [];
      const location = objectiveMapLocation(quest.id, objective, objective);
      return location ? [location] : [];
    });
  });
};

/**
 * Pair the active target with its artwork provider, which can be a completed predecessor.
 * Missing or concealed coordinates never produce a landmark.
 */
const objectiveMapLocation = (
  questId: string,
  objective: {
    id: string;
    sector?: number;
    longitude?: number;
    latitude?: number;
    overworldPlacementId?: string;
  },
  presentation: AllObjectivesType,
): MapLocation | null => {
  if (
    !presentation.structureAssetId ||
    objective.sector === undefined ||
    !isValidSectorId(objective.sector) ||
    ![objective.longitude, objective.latitude].every(
      (v) => typeof v === "number" && Number.isInteger(v) && v >= 0,
    ) ||
    (objective.longitude ?? Infinity) >= SECTOR_MAP_MAX_DIMENSION ||
    (objective.latitude ?? Infinity) >= SECTOR_MAP_MAX_DIMENSION
  )
    return null;
  return {
    id: questLocationId(questId, presentation.id),
    questId,
    objectiveId: objective.id,
    ...(objective.overworldPlacementId
      ? { npcPlacementId: objective.overworldPlacementId }
      : {}),
    sector: objective.sector,
    longitude: objective.longitude as number,
    latitude: objective.latitude as number,
    name: presentation.locationName || "Quest location",
    description: presentation.locationDescription || "",
    assetId: presentation.structureAssetId,
    scale: presentation.structureScale ?? 1,
  };
};

/**
 * Fill missing dialog coordinates from completed predecessors, using live fixed NPC positions.
 * Preserve tracker values, including zero and concealment sentinels, over authored defaults.
 */
const resolveObjectiveCoordinates = (
  objective: AllObjectivesType,
  objectives: AllObjectivesType[],
  tracker: QuestTrackerType,
  placements: MapPlacement[],
  viewer: Pick<UserData, "sector" | "role">,
) => {
  const coordinates: Pick<AllObjectivesType, "sector" | "longitude" | "latitude"> = {};
  let current = objective;
  let hasConcealedLocation = false;
  const visited = new Set<string>();
  while (!visited.has(current.id)) {
    visited.add(current.id);
    const goal = tracker.goals.find((g) => g.id === current.id);
    const placement = current.overworldPlacementId
      ? placements.find((p) => p.npcPlacementId === current.overworldPlacementId)
      : undefined;
    if (current.overworldPlacementId && !placement) return null;
    hasConcealedLocation ||= "hideLocation" in current && current.hideLocation;
    coordinates.sector ??= placement?.sector ?? goal?.sector ?? current.sector;
    coordinates.longitude ??=
      placement?.longitude ?? goal?.longitude ?? current.longitude;
    coordinates.latitude ??= placement?.latitude ?? goal?.latitude ?? current.latitude;
    if (
      current.task !== "dialog" ||
      (coordinates.sector !== undefined &&
        coordinates.longitude !== undefined &&
        coordinates.latitude !== undefined)
    )
      break;
    const previous = findCompletedPredecessor(objectives, current.id, tracker);
    if (!previous) break;
    current = previous;
  }
  // Live NPC positions and inherited dialog locations obey the authored concealment rule.
  if (
    hasConcealedLocation &&
    coordinates.sector !== viewer.sector &&
    !canChangeContent(viewer.role)
  )
    return null;
  return coordinates;
};

/** Public scenery survives completion; private scenery follows the selected same-location chain. */
export const getQuestMapLocations = (
  user: Pick<UserData, "questData" | "sector" | "role"> & {
    userQuests: Pick<UserQuest, "completed" | "endAt" | "quest">[];
  },
  publicLocations: MapLocation[],
  placements: MapPlacement[] = [],
): MapLocation[] => {
  const locations = new Map(publicLocations.map((location) => [location.id, location]));
  for (const entry of user.userQuests) {
    if (entry.completed || entry.endAt || !entry.quest) continue;
    const quest = entry.quest;
    const tracker = user.questData?.find((t) => t.id === quest.id);
    if (!tracker) continue;
    quest.content.objectives.forEach((objective, index) => {
      const goal = tracker.goals.find((g) => g.id === objective.id);
      if (!goal || goal.done || !isQuestObjectiveAvailable(quest, tracker, index))
        return;
      const coordinates = resolveObjectiveCoordinates(
        objective,
        quest.content.objectives,
        tracker,
        placements,
        user,
      );
      if (!coordinates) return;
      const resolved = { ...objective, ...coordinates };
      let presentation = objective;
      const visited = new Set<string>();
      while (!presentation.structureAssetId && !visited.has(presentation.id)) {
        visited.add(presentation.id);
        const previous = findCompletedPredecessor(
          quest.content.objectives,
          presentation.id,
          tracker,
        );
        if (!previous) break;
        const previousLocation = resolveObjectiveCoordinates(
          previous,
          quest.content.objectives,
          tracker,
          placements,
          user,
        );
        if (
          !previousLocation ||
          previousLocation.sector !== resolved.sector ||
          previousLocation.longitude !== resolved.longitude ||
          previousLocation.latitude !== resolved.latitude
        )
          break;
        presentation = previous;
      }
      const location = objectiveMapLocation(quest.id, resolved, presentation);
      if (location) locations.set(location.id, { ...location, active: true });
    });
  }
  return [...locations.values()];
};

/** One sprite per tile, preferring active quests while retaining every location's actions. */
export const groupMapLocations = (locations: MapLocation[]) => {
  const groups = new Map<string, MapLocation[]>();
  for (const location of locations) {
    const key = `${location.sector}:${location.longitude}:${location.latitude}`;
    const group = groups.get(key) ?? [];
    group.push(location);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) =>
    group.sort(
      (a, b) => Number(!!b.active) - Number(!!a.active) || a.id.localeCompare(b.id),
    ),
  );
};

type MapPlacement = {
  npcPlacementId?: string | null;
  sector: number;
  longitude: number;
  latitude: number;
};
