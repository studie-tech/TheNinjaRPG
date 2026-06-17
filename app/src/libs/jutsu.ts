import type { FederalStatus } from "@/drizzle/constants";
import {
  JUTSU_MAX_BARRIER_EQUIPPED,
  JUTSU_MAX_EVENT_EQUIPPED,
  JUTSU_MAX_PIERCE_EQUIPPED,
  JUTSU_MAX_RESIDUAL_EQUIPPED,
  JUTSU_MAX_STUN_EQUIPPED,
  JUTSU_TRANSFER_FREE_AMOUNT,
  JUTSU_TRANSFER_FREE_GOLD,
  JUTSU_TRANSFER_FREE_NORMAL,
  JUTSU_TRANSFER_FREE_SILVER,
} from "@/drizzle/constants";
import type { UserJutsuWithRelations } from "@/drizzle/schema";
import { calcJutsuEquipLimit, canUseJutsu } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { canChangeContent } from "@/utils/permissions";

/**
 * Get the number of free jutsu level transfers based on the federal status
 * @param federalStatus
 * @returns
 */
export const getFreeTransfers = (federalStatus: FederalStatus) => {
  switch (federalStatus) {
    case "GOLD":
      return JUTSU_TRANSFER_FREE_GOLD;
    case "SILVER":
      return JUTSU_TRANSFER_FREE_SILVER;
    case "NORMAL":
      return JUTSU_TRANSFER_FREE_NORMAL;
    default:
      return JUTSU_TRANSFER_FREE_AMOUNT;
  }
};

export interface ComputedJutsuLoadout {
  equipIds: string[];
  invalidJutsus: string[];
}

/**
 * Pure decision logic for applying a jutsu loadout. Validates every saved
 * jutsuId against the user's ownership, the hidden-content gate, usability
 * requirements (canUseJutsu) and the same equip caps toggleEquip enforces,
 * preserving the loadout's order and stopping at each cap. Skipped jutsu are
 * reported in `invalidJutsus`. No database access — fully unit-testable.
 *
 * Requires a full UserWithRelations (canUseJutsu reads bloodline/village/element
 * relations), so this runs on the jutsu-management path where that data is
 * loaded; the slim combat battle-state does not carry those relations.
 */
export const computeJutsuLoadoutAssignments = (args: {
  jutsuIds: string[];
  userjutsus: UserJutsuWithRelations[];
  user: NonNullable<UserWithRelations>;
}): ComputedJutsuLoadout => {
  const { jutsuIds, userjutsus, user } = args;
  const equipIds: string[] = [];
  const invalidJutsus: string[] = [];
  const maxEquip = calcJutsuEquipLimit(user);
  let total = 0;
  let pierce = 0;
  let event = 0;
  let barrier = 0;
  let stun = 0;
  let residual = 0;

  for (const jutsuId of jutsuIds) {
    const uj = userjutsus.find((j) => j.jutsuId === jutsuId);
    if (!uj) {
      invalidJutsus.push("Jutsu not found");
      continue;
    }
    const jutsu = uj.jutsu;
    if (jutsu.hidden && !canChangeContent(user.role)) {
      invalidJutsus.push(`${jutsu.name} is hidden`);
      continue;
    }
    if (!canUseJutsu(jutsu, user)) {
      invalidJutsus.push(`${jutsu.name}: missing requirements`);
      continue;
    }
    const isResidual = jutsu.effects.some(
      (e) => "residualModifier" in e && e.residualModifier,
    );
    const isPierce = jutsu.effects.some((e) => e.type === "pierce");
    const isEvent = jutsu.jutsuType === "EVENT";
    const isBarrier = jutsu.effects.some((e) => e.type === "barrier");
    const isStun = jutsu.effects.some((e) => e.type === "stun");
    if (total >= maxEquip) {
      invalidJutsus.push(`${jutsu.name}: equip limit reached`);
      continue;
    }
    if (isResidual && residual >= JUTSU_MAX_RESIDUAL_EQUIPPED) {
      invalidJutsus.push(`${jutsu.name}: residual jutsu limit reached`);
      continue;
    }
    if (isPierce && pierce >= JUTSU_MAX_PIERCE_EQUIPPED) {
      invalidJutsus.push(`${jutsu.name}: piercing jutsu limit reached`);
      continue;
    }
    if (isEvent && event >= JUTSU_MAX_EVENT_EQUIPPED) {
      invalidJutsus.push(`${jutsu.name}: event jutsu limit reached`);
      continue;
    }
    if (isBarrier && barrier >= JUTSU_MAX_BARRIER_EQUIPPED) {
      invalidJutsus.push(`${jutsu.name}: barrier jutsu limit reached`);
      continue;
    }
    if (isStun && stun >= JUTSU_MAX_STUN_EQUIPPED) {
      invalidJutsus.push(`${jutsu.name}: stun jutsu limit reached`);
      continue;
    }
    equipIds.push(jutsuId);
    total += 1;
    if (isResidual) residual += 1;
    if (isPierce) pierce += 1;
    if (isEvent) event += 1;
    if (isBarrier) barrier += 1;
    if (isStun) stun += 1;
  }

  return { equipIds, invalidJutsus };
};

/**
 * Get the reskinned user jutsu, generic version
 * @param userJutsu
 * @returns
 */
export const getReskinnedUserJutsu = <T extends UserJutsuWithRelations>(
  userJutsu: T,
): T => {
  if (!userJutsu.activeReskin) {
    return userJutsu;
  }
  return {
    ...userJutsu,
    jutsu: {
      ...userJutsu.jutsu,
      ...(userJutsu.activeReskin.name && { name: userJutsu.activeReskin.name }),
      ...(userJutsu.activeReskin.image && { image: userJutsu.activeReskin.image }),
      ...(userJutsu.activeReskin.description && {
        description: userJutsu.activeReskin.description,
      }),
      ...(userJutsu.activeReskin.battleDescription && {
        battleDescription: userJutsu.activeReskin.battleDescription,
      }),
    },
  } as T;
};
