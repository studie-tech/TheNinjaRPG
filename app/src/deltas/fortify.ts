import type { RouterOutputs } from "@/app/_trpc/client";
import { getUserEquipmentPatch } from "@/deltas/item";
import type { UserItem } from "@/drizzle/schema";
import type { fetchUserEquipmentSnapshot } from "@/queries/item";
import type { UserWithRelations } from "@/routers/profile";

type FortifyUpdate = Extract<
  RouterOutputs["item"]["fortify"],
  { fortifyUpdate: unknown }
>["fortifyUpdate"];

/** Patch only the exact owned copy and revision that the server charged for this attempt. */
export const getFortifiedInventory = <T extends UserItem>(
  rows: T[],
  update: FortifyUpdate,
): T[] | undefined => {
  if (
    update.requiresRefresh ||
    !rows.some(
      (row) =>
        row.id === update.id &&
        row.userId === update.userId &&
        row.updatedAt.getTime() === update.beforeUpdatedAt.getTime(),
    )
  )
    return;
  return rows.map((row) =>
    row.id === update.id
      ? { ...row, fortification: update.fortification, updatedAt: update.updatedAt }
      : row,
  );
};

/** Build derived gear values from complete effect sources loaded before the write. */
export const buildFortifyEquipmentPatch = (
  equipment: Awaited<ReturnType<typeof fetchUserEquipmentSnapshot>>,
  id: string,
  fortification: UserItem["fortification"],
  updatedAt: Date,
) =>
  equipment
    ? getUserEquipmentPatch({
        ...equipment,
        items: equipment.items.map((row) =>
          row.id === id ? { ...row, fortification, updatedAt } : row,
        ),
      })
    : undefined;

/** Apply the server's derived equipment projection only against the charged profile baseline. */
export const getFortifiedUserPatch = (
  user: NonNullable<UserWithRelations>,
  update: FortifyUpdate,
) => {
  if (
    update.requiresRefresh ||
    user.userId !== update.userId ||
    user.money !== update.beforeMoney ||
    !update.userPatch
  )
    return;
  if (
    user.items.some(
      (row) =>
        row.id === update.id &&
        row.updatedAt.getTime() !== update.beforeUpdatedAt.getTime(),
    )
  )
    return;
  return update.userPatch;
};
