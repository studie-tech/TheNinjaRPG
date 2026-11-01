import { getEquippedJutsuUserPatch } from "@/deltas/jutsu";
import type { RenameLoadoutSchema } from "@/validators/loadout";

/**
 * Rename the matching loaded row using the trimmed saved name while preserving other fields
 * and rows. Return undefined when the destination is missing and needs an authoritative read.
 */
export const getRenamedLoadouts = <T extends { id: string; name: string }>(
  loadouts: T[],
  input: RenameLoadoutSchema,
): T[] | undefined => {
  if (!loadouts.some((loadout) => loadout.id === input.id)) return;
  return loadouts.map((loadout) =>
    loadout.id === input.id ? { ...loadout, name: input.name.trim() } : loadout,
  );
};

/** Replace the confirmed loadout order, preserving names and unrelated loadouts; missing rows refetch. */
export const getOrderedJutsuLoadouts = <T extends { id: string; jutsuIds: string[] }>(
  loadouts: T[],
  id: string,
  jutsuIds: string[] | undefined,
): T[] | undefined => {
  if (!jutsuIds || !loadouts.some((entry) => entry.id === id)) return;
  return loadouts.map((entry) => (entry.id === id ? { ...entry, jutsuIds } : entry));
};

/** Apply a confirmed equip operation only to the loaded server baseline; uncertain memberships refetch. */
export const getEquippedJutsuLoadouts = <T extends { id: string; jutsuIds: string[] }>(
  loadouts: T[],
  change:
    | {
        jutsuId: string;
        equipped: boolean;
        loadout?: { id: string; jutsuIds: string[] };
      }
    | undefined,
): T[] | undefined => {
  const before = change?.loadout;
  const current = loadouts.find((entry) => entry.id === before?.id);
  if (
    !change ||
    !before ||
    !current ||
    JSON.stringify(current.jutsuIds) !== JSON.stringify(before.jutsuIds)
  )
    return;
  return getOrderedJutsuLoadouts(
    loadouts,
    before.id,
    getEquippedJutsuUserPatch(current.jutsuIds, change).loadout.jutsuIds,
  );
};

/**
 * Show a loadout's new battle hotkeys before the save confirms them, keeping other rows.
 * Return undefined when the loadout is not loaded, so nothing is patched.
 */
export const getLoadoutsWithHotkeys = <
  T extends { id: string; hotkeys: Record<string, string> },
>(
  loadouts: T[],
  loadoutId: string,
  hotkeys: Record<string, string>,
): T[] | undefined => {
  if (!loadouts.some((loadout) => loadout.id === loadoutId)) return;
  return loadouts.map((loadout) =>
    loadout.id === loadoutId ? { ...loadout, hotkeys } : loadout,
  );
};
