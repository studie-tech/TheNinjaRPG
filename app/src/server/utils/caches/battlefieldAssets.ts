import { selectBattlefieldAssets } from "@/queries/asset";
import { createRuntimeCache } from "@/server/utils/caches/runtimeCache";

// Every battle start places obstacles from the released battlefield assets. The filter has
// no index and the set changes only when staff save or delete one of them, so it is shared
// through the Runtime Cache; the TTL bounds rows changed outside the asset editor.
const battlefieldAssets = createRuntimeCache({
  name: "battlefield-assets",
  ttlSeconds: 60 * 60,
  cloneReads: false,
  load: selectBattlefieldAssets,
});

/** The released assets placed on new battlefields. Callers share the rows and must not mutate them. */
export const fetchBattlefieldAssets = battlefieldAssets.read;

/** Make every instance list battlefield assets again; await after writes to one. */
export const invalidateBattlefieldAssets = battlefieldAssets.invalidate;
