import type { FederalStatus } from "@/drizzle/constants";
import {
  JUTSU_MAX_BARRIER_EQUIPPED,
  JUTSU_MAX_EVENT_EQUIPPED,
  JUTSU_MAX_PIERCE_EQUIPPED,
  JUTSU_MAX_RESIDUAL_EQUIPPED,
  JUTSU_MAX_SHIELD_EQUIPPED,
  JUTSU_MAX_STUN_EQUIPPED,
  JUTSU_TRANSFER_FREE_AMOUNT,
  JUTSU_TRANSFER_FREE_GOLD,
  JUTSU_TRANSFER_FREE_NORMAL,
  JUTSU_TRANSFER_FREE_SILVER,
} from "@/drizzle/constants";
import type { Jutsu, UserJutsuWithRelations } from "@/drizzle/schema";
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

export interface JutsuCapFlags {
  isResidual: boolean;
  isPierce: boolean;
  isEvent: boolean;
  isBarrier: boolean;
  isShield: boolean;
  isStun: boolean;
}

/**
 * Which capped equip categories a jutsu counts against (residual / pierce /
 * event / barrier / shield / stun). Centralised so the loadout, toggle-equip and
 * auto-equip paths share one definition and a new capped category only needs
 * editing in one place.
 */
export const getJutsuCapFlags = (
  jutsu: Pick<Jutsu, "effects" | "jutsuType">,
): JutsuCapFlags => ({
  isResidual: jutsu.effects.some((e) => "residualModifier" in e && e.residualModifier),
  isPierce: jutsu.effects.some((e) => e.type === "pierce"),
  isEvent: jutsu.jutsuType === "EVENT",
  isBarrier: jutsu.effects.some((e) => e.type === "barrier"),
  isShield: jutsu.effects.some((e) => e.type === "shield"),
  isStun: jutsu.effects.some((e) => e.type === "stun"),
});

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
  let shield = 0;
  let stun = 0;
  let residual = 0;

  // A jutsu is equipped or not (no quantity), and the equip CASE matches by
  // jutsuId, so a duplicate id in a stale loadout equips the same row once.
  // Dedupe up front so duplicates cannot double-count toward the caps and
  // falsely reject a later jutsu.
  const uniqueJutsuIds = [...new Set(jutsuIds)];

  for (const jutsuId of uniqueJutsuIds) {
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
    const { isResidual, isPierce, isEvent, isBarrier, isShield, isStun } =
      getJutsuCapFlags(jutsu);
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
    if (isShield && shield >= JUTSU_MAX_SHIELD_EQUIPPED) {
      invalidJutsus.push(`${jutsu.name}: shield jutsu limit reached`);
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
    if (isShield) shield += 1;
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
