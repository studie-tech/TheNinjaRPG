import { selectActiveSectorPlacements } from "@/queries/overworldAi";
import { createRuntimeCache } from "@/server/utils/caches/runtimeCache";

// Every sector poll draws the active placements around the viewer. They change only when
// staff edit a placement, its AI template or the template's animations, and when the daily
// cron repositions them; those writes invalidate the cache, and the TTL bounds any other.
const overworldSectorPlacements = createRuntimeCache({
  name: "overworld-sector-placements",
  ttlSeconds: 5 * 60,
  load: selectActiveSectorPlacements,
});

/** Every active placement with its AI template and idle/move sheets, ordered by id. */
export const fetchOverworldSectorPlacements = overworldSectorPlacements.read;

/**
 * Make every instance read the sector placements again; await after writes to a placement,
 * an AI template's sector fields or its idle/move animation bindings.
 */
export const invalidateOverworldSectorPlacements = overworldSectorPlacements.invalidate;
