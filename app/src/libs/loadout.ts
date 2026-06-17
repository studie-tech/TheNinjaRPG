import type { RenameLoadoutSchema } from "@/validators/loadout";

/**
 * Looks up a loadout by id but only within the loadouts the user is currently
 * entitled to (the first `maxLoadouts` by creation order, matching what
 * getLoadouts exposes). Returns undefined when the id is unknown or out of
 * range, so a downgraded user cannot reach an out-of-range loadout by guessing
 * its deterministic id. Shared by the item and jutsu select/rename paths.
 */
export const findAllowedLoadout = <T extends { id: string }>(
  loadouts: T[],
  loadoutId: string,
  maxLoadouts: number,
): T | undefined => {
  const index = loadouts.findIndex((l) => l.id === loadoutId);
  return index >= 0 && index < maxLoadouts ? loadouts[index] : undefined;
};

/**
 * Pure decision for renaming a loadout, shared by the item and jutsu routers.
 * Reports a no-op when the name is unchanged so the caller can skip a redundant
 * write. No database access — fully unit-testable.
 */
export type RenameDecision =
  | { ok: false; message: string }
  | { ok: true; changed: false; message: string }
  | { ok: true; changed: true; name: string };

export const decideRename = (
  loadouts: Array<{ id: string; name: string }>,
  maxLoadouts: number,
  input: RenameLoadoutSchema,
): RenameDecision => {
  const loadout = findAllowedLoadout(loadouts, input.id, maxLoadouts);
  if (!loadout) {
    return { ok: false, message: "Loadout not found" };
  }
  if (loadout.name === input.name) {
    return { ok: true, changed: false, message: "Loadout name unchanged" };
  }
  return { ok: true, changed: true, name: input.name };
};

/**
 * Builds the rows for any loadout slots a user is entitled to but does not yet
 * own, shared by the item and jutsu routers. Uses a deterministic id per index
 * so concurrent reads upsert the same row instead of inserting duplicates, and
 * a strictly increasing createdAt so the rows keep a stable ascending order
 * (the order getLoadouts slices by). Returns an empty array when nothing is
 * missing. No database access — the caller performs one batched upsert.
 */
export const buildMissingLoadouts = <C extends Record<string, unknown>>(
  userId: string,
  kind: "item" | "jutsu",
  existingCount: number,
  maxLoadouts: number,
  emptyContent: C,
  baseTime: Date,
): Array<{ id: string; userId: string; name: string; createdAt: Date } & C> => {
  const rows: Array<{ id: string; userId: string; name: string; createdAt: Date } & C> =
    [];
  for (let i = existingCount; i < maxLoadouts; i++) {
    rows.push({
      id: `${userId}-${kind}-${i}`,
      userId,
      name: "",
      createdAt: new Date(baseTime.getTime() + i),
      ...emptyContent,
    });
  }
  return rows;
};
