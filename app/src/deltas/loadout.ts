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
