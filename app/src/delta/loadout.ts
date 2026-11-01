import type { RenameLoadoutSchema } from "@/validators/loadout";

/** Rename only a known row; a missing destination needs an authoritative read. */
export const getRenamedLoadouts = <T extends { id: string; name: string }>(
  loadouts: T[],
  input: RenameLoadoutSchema,
): T[] | undefined => {
  if (!loadouts.some((loadout) => loadout.id === input.id)) return;
  return loadouts.map((loadout) =>
    loadout.id === input.id ? { ...loadout, name: input.name.trim() } : loadout,
  );
};
