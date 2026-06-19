/**
 * Shared server-side helpers for the item and jutsu loadout endpoints. The
 * pure decision logic lives in `@/libs/loadout`; these wrap the database
 * orchestration the two routers would otherwise copy-paste, taking the
 * table-specific Drizzle calls as callbacks so they stay fully typed per router.
 */
import { eq } from "drizzle-orm";
import { userData } from "@/drizzle/schema";
import type { RenameDecision } from "@/libs/loadout";
import { type BaseServerResponse, errorResponse } from "@/server/api/trpc";
import type { DrizzleClient } from "@/server/db";

/**
 * Thin userData fetch for the loadout endpoints: only the columns needed to
 * derive the federal loadout allowance and read the active-loadout pointers,
 * instead of the full row that fetchUser returns.
 */
export const fetchLoadoutUser = async (client: DrizzleClient, userId: string) => {
  return await client.query.userData.findFirst({
    where: eq(userData.userId, userId),
    columns: {
      userId: true,
      federalStatus: true,
      staffAccount: true,
      itemLoadout: true,
      jutsuLoadout: true,
    },
  });
};

/**
 * Backfill orchestration shared by the item and jutsu getLoadouts endpoints:
 * upserts the missing rows in one batched statement, sets a default active
 * pointer when none is set, and returns the allowance-sliced list. Keeps the
 * default-pointer policy in one place so the two endpoints cannot drift.
 */
export const backfillLoadouts = async <T extends { id: string }>(args: {
  loadouts: T[];
  missing: T[];
  maxLoadouts: number;
  currentPointer: string | null;
  insertMissing: (rows: T[]) => PromiseLike<unknown>;
  writeDefaultPointer: (loadoutId: string) => PromiseLike<unknown>;
}): Promise<T[]> => {
  if (args.missing.length > 0) {
    await args.insertMissing(args.missing);
  }
  // Build a local merged list rather than mutating the caller-owned array.
  const merged =
    args.missing.length > 0 ? [...args.loadouts, ...args.missing] : args.loadouts;
  const first = merged[0];
  if (first && !args.currentPointer) {
    await args.writeDefaultPointer(first.id);
  }
  return args.maxLoadouts < merged.length ? merged.slice(0, args.maxLoadouts) : merged;
};

/**
 * Rename application shared by the item and jutsu renameLoadout endpoints.
 * Branches on the pure decision, performs the table-specific update via the
 * callback. PlanetScale reports CHANGED (not matched) rows, so rowsAffected===0
 * is ambiguous: it means either the row vanished/isn't owned OR a concurrent
 * request already set this exact name. The optional verifyExists re-read (only
 * run in that rare zero-rows case) tells the two apart so a benign no-op isn't
 * reported as "not found".
 */
export const applyLoadoutRename = async (
  decision: RenameDecision,
  performUpdate: (name: string) => PromiseLike<{ rowsAffected: number }>,
  verifyExists?: () => PromiseLike<boolean>,
): Promise<BaseServerResponse> => {
  if (!decision.ok) return errorResponse(decision.message);
  if (!decision.changed) return { success: true, message: decision.message };
  const result = await performUpdate(decision.name);
  if (result.rowsAffected === 0) {
    const stillExists = verifyExists ? await verifyExists() : false;
    if (!stillExists) return errorResponse("Loadout not found");
  }
  return { success: true, message: "Loadout renamed" };
};
