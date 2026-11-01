import type { UserData, UserItem, UserItemWithRelations } from "@/drizzle/schema";
import { effectiveMasteries, type MasteryBuffUser } from "@/libs/mastery";
import { calcMaxEnergy } from "@/libs/profile";
import { hasEnergyQueue } from "@/libs/queue";

type EquipmentSnapshot = Omit<MasteryBuffUser, "items"> &
  Pick<UserData, "energyQueueHead" | "energyQueueTail" | "itemLoadout"> & {
    items: UserItemWithRelations[];
  };

/** Derive only the gear fields affected by a confirmed write; balances remain deltas. */
export const getUserEquipmentPatch = (user: EquipmentSnapshot) => {
  if (hasEnergyQueue(user)) return;
  return {
    items: user.items,
    itemLoadout: user.itemLoadout,
    maxEnergy: calcMaxEnergy(user),
    effectiveMasteries: effectiveMasteries(user),
  };
};

/** A mismatched initial gear read cannot describe the target claimed by a repair. */
export const getRepairedEquipmentUpdate = (
  user: EquipmentSnapshot,
  changes: {
    before: Pick<
      UserItem,
      "id" | "durability" | "quantity" | "equipped" | "level" | "experience"
    >;
    durability?: number;
    quantity?: number;
  }[],
  cost = 0,
) => {
  if (
    changes.some(({ before }) => {
      const original = user.items.find((entry) => entry.id === before.id);
      return original
        ? original.durability !== before.durability ||
            original.quantity !== before.quantity ||
            original.equipped !== before.equipped ||
            original.level !== before.level ||
            original.experience !== before.experience
        : before.equipped !== "NONE";
    })
  )
    return {};
  const items = user.items.flatMap((entry) => {
    const updated = { ...entry };
    for (const change of changes) {
      if (change.before.id !== entry.id) continue;
      if (change.durability !== undefined) updated.durability = change.durability;
      if (change.quantity !== undefined) updated.quantity = change.quantity;
    }
    return updated.quantity > 0 ? [updated] : [];
  });
  const userPatch = getUserEquipmentPatch({ ...user, items });
  return {
    userPatch,
    userDelta: userPatch ? { money: cost > 0 ? -cost : 0 } : undefined,
  };
};
