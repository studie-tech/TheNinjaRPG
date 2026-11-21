import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { createRuntimeEntryCache } from "@/server/utils/caches/runtimeCache";

// Published sector maps by sector. A published row never changes, and readers serve an
// entry only when it names the row they just read, so a cold instance downloads a blob
// only when the sector was republished or its regional entry has expired, at most a day
// after it was written. Environments read different databases, so each keeps its own
// entries, and deployments of one environment share them.
export const publishedSectorMaps = createRuntimeEntryCache<PublishedMap>({
  name: "published-sector-maps",
  ttlSeconds: 24 * 60 * 60,
  scope: "environment",
});

/** The published row a map was read from. */
export type PublishedMapRevision = { id: string; version: number };

/** A published map with the row it was read from. */
export type PublishedMap = PublishedMapRevision & { map: NormalizedSectorMap };
