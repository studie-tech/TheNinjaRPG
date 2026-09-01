import type { FederalStatus } from "@/drizzle/constants";
import {
  JUTSU_MAX_BARRIER_EQUIPPED,
  JUTSU_MAX_EVENT_EQUIPPED,
  JUTSU_MAX_FORBIDDEN_EQUIPPED,
  JUTSU_MAX_HEAL_EQUIPPED,
  JUTSU_MAX_PIERCE_EQUIPPED,
  JUTSU_MAX_RESIDUAL_EQUIPPED,
  JUTSU_MAX_SHIELD_EQUIPPED,
  JUTSU_MAX_STUN_EQUIPPED,
  JUTSU_TRANSFER_FREE_AMOUNT,
  JUTSU_TRANSFER_FREE_GOLD,
  JUTSU_TRANSFER_FREE_NORMAL,
  JUTSU_TRANSFER_FREE_SILVER,
  RANKED_LOADOUT_MAX_BARRIER_JUTSUS,
  RANKED_LOADOUT_MAX_HEAL_JUTSUS,
  RANKED_LOADOUT_MAX_INCREASECOST_JUTSUS,
  RANKED_LOADOUT_MAX_POISON_JUTSUS,
  RANKED_LOADOUT_MAX_RESIDUAL_JUTSUS,
  RANKED_LOADOUT_MAX_SHIELD_JUTSUS,
  RANKED_LOADOUT_MAX_STUN_JUTSUS,
  RANKED_LOADOUT_MAX_SUMMON_JUTSUS,
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

type JutsuCapMatchInput = Pick<Jutsu, "effects" | "jutsuType">;

/**
 * All jutsu category predicates (normal equip + ranked-only). Single definition of
 * what counts as residual / heal / poison / etc. so equip and ranked caps stay aligned.
 */
export const JUTSU_CATEGORY_DEFS = [
  {
    key: "isResidual",
    label: "residual",
    matches: (jutsu: JutsuCapMatchInput) =>
      jutsu.effects.some((e) => "residualModifier" in e && e.residualModifier),
  },
  {
    key: "isPierce",
    label: "piercing",
    matches: (jutsu: JutsuCapMatchInput) =>
      jutsu.effects.some((e) => e.type === "pierce"),
  },
  {
    key: "isEvent",
    label: "event",
    matches: (jutsu: JutsuCapMatchInput) => jutsu.jutsuType === "EVENT",
  },
  {
    key: "isForbidden",
    label: "forbidden",
    matches: (jutsu: JutsuCapMatchInput) => jutsu.jutsuType === "FORBIDDEN",
  },
  {
    key: "isBarrier",
    label: "barrier",
    matches: (jutsu: JutsuCapMatchInput) =>
      jutsu.effects.some((e) => e.type === "barrier"),
  },
  {
    key: "isStun",
    label: "stun",
    matches: (jutsu: JutsuCapMatchInput) =>
      jutsu.effects.some((e) => e.type === "stun"),
  },
  {
    key: "isShield",
    label: "shield",
    matches: (jutsu: JutsuCapMatchInput) =>
      jutsu.effects.some((e) => e.type === "shield"),
  },
  {
    key: "isHeal",
    label: "heal",
    matches: (jutsu: JutsuCapMatchInput) =>
      jutsu.effects.some((e) => e.type === "heal"),
  },
  {
    key: "isPoison",
    label: "poison",
    matches: (jutsu: JutsuCapMatchInput) =>
      jutsu.effects.some((e) => e.type === "poison"),
  },
  {
    key: "isIncreaseCost",
    label: "increasecost",
    matches: (jutsu: JutsuCapMatchInput) =>
      jutsu.effects.some((e) => e.type === "increasepoolcost"),
  },
  {
    key: "isSummon",
    label: "summon",
    matches: (jutsu: JutsuCapMatchInput) =>
      jutsu.effects.some((e) => e.type === "summon"),
  },
] as const;

export type JutsuCapFlagKey = (typeof JUTSU_CATEGORY_DEFS)[number]["key"];
export type JutsuCapFlags = Record<JutsuCapFlagKey, boolean>;
export type JutsuCategoryDef = (typeof JUTSU_CATEGORY_DEFS)[number];

export const getJutsuCategoryDef = (key: JutsuCapFlagKey): JutsuCategoryDef => {
  const def = JUTSU_CATEGORY_DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`Unknown jutsu category: ${key}`);
  return def;
};

/** Which categories a jutsu counts against (equip + ranked). */
export const getJutsuCapFlags = (jutsu: JutsuCapMatchInput): JutsuCapFlags =>
  Object.fromEntries(
    JUTSU_CATEGORY_DEFS.map((def) => [def.key, def.matches(jutsu)]),
  ) as JutsuCapFlags;

/**
 * Normal equip caps. Subset of JUTSU_CATEGORY_DEFS enforced outside ranked.
 * Loadout / toggleEquip / startTraining / SQL CAS all loop this table.
 */
export const JUTSU_EQUIP_CAPS = [
  {
    key: "isResidual",
    max: JUTSU_MAX_RESIDUAL_EQUIPPED,
    countAlias: "residual_cnt",
    sql: { kind: "residual" as const },
  },
  {
    key: "isPierce",
    max: JUTSU_MAX_PIERCE_EQUIPPED,
    countAlias: "pierce_cnt",
    sql: { kind: "effect" as const, effectType: "pierce" },
  },
  {
    key: "isEvent",
    max: JUTSU_MAX_EVENT_EQUIPPED,
    countAlias: "event_cnt",
    sql: { kind: "jutsuType" as const, jutsuType: "EVENT" },
  },
  {
    key: "isForbidden",
    max: JUTSU_MAX_FORBIDDEN_EQUIPPED,
    countAlias: "forbidden_cnt",
    sql: { kind: "jutsuType" as const, jutsuType: "FORBIDDEN" },
  },
  {
    key: "isBarrier",
    max: JUTSU_MAX_BARRIER_EQUIPPED,
    countAlias: "barrier_cnt",
    sql: { kind: "effect" as const, effectType: "barrier" },
  },
  {
    key: "isStun",
    max: JUTSU_MAX_STUN_EQUIPPED,
    countAlias: "stun_cnt",
    sql: { kind: "effect" as const, effectType: "stun" },
  },
  {
    key: "isShield",
    max: JUTSU_MAX_SHIELD_EQUIPPED,
    countAlias: "shield_cnt",
    sql: { kind: "effect" as const, effectType: "shield" },
  },
  {
    key: "isHeal",
    max: JUTSU_MAX_HEAL_EQUIPPED,
    countAlias: "heal_cnt",
    sql: { kind: "effect" as const, effectType: "heal" },
  },
] as const satisfies readonly {
  key: JutsuCapFlagKey;
  max: number;
  countAlias: string;
  sql:
    | { kind: "residual" }
    | { kind: "effect"; effectType: string }
    | { kind: "jutsuType"; jutsuType: string };
}[];

export type JutsuEquipCap = (typeof JUTSU_EQUIP_CAPS)[number];
export type JutsuCapCounts = Record<JutsuEquipCap["key"], number>;

/**
 * Ranked loadout category caps. Predicates come from getJutsuCapFlags /
 * JUTSU_CATEGORY_DEFS; only the max values differ (or match equip for event/forbidden).
 */
export const RANKED_JUTSU_CAPS = [
  { key: "isResidual", max: RANKED_LOADOUT_MAX_RESIDUAL_JUTSUS },
  { key: "isPoison", max: RANKED_LOADOUT_MAX_POISON_JUTSUS },
  { key: "isIncreaseCost", max: RANKED_LOADOUT_MAX_INCREASECOST_JUTSUS },
  { key: "isSummon", max: RANKED_LOADOUT_MAX_SUMMON_JUTSUS },
  { key: "isBarrier", max: RANKED_LOADOUT_MAX_BARRIER_JUTSUS },
  { key: "isStun", max: RANKED_LOADOUT_MAX_STUN_JUTSUS },
  { key: "isShield", max: RANKED_LOADOUT_MAX_SHIELD_JUTSUS },
  { key: "isHeal", max: RANKED_LOADOUT_MAX_HEAL_JUTSUS },
  { key: "isEvent", max: JUTSU_MAX_EVENT_EQUIPPED },
  { key: "isForbidden", max: JUTSU_MAX_FORBIDDEN_EQUIPPED },
] as const satisfies readonly { key: JutsuCapFlagKey; max: number }[];

/** Ranked select-UI warnings (subset of RANKED_JUTSU_CAPS shown when picking a jutsu). */
export const RANKED_JUTSU_SELECT_WARNINGS = [
  "isResidual",
  "isPoison",
  "isIncreaseCost",
  "isHeal",
] as const satisfies readonly JutsuCapFlagKey[];

const emptyCapCounts = (): JutsuCapCounts =>
  Object.fromEntries(JUTSU_EQUIP_CAPS.map((cap) => [cap.key, 0])) as JutsuCapCounts;

/** True when any normal-equip capped category flag is set (e.g. force-unequip on evolution). */
export const hasAnyJutsuEquipCap = (flags: JutsuCapFlags) =>
  JUTSU_EQUIP_CAPS.some((cap) => flags[cap.key]);

/** Equipped counts per normal-equip capped category. */
export const countEquippedByCap = (
  equippedJutsus: { jutsu: JutsuCapMatchInput }[],
): JutsuCapCounts => {
  const counts = emptyCapCounts();
  for (const uj of equippedJutsus) {
    const flags = getJutsuCapFlags(uj.jutsu);
    for (const cap of JUTSU_EQUIP_CAPS) {
      if (flags[cap.key]) counts[cap.key] += 1;
    }
  }
  return counts;
};

/** Whether `flags` fit under `equippedCounts` for every normal-equip capped category. */
export const canEquipUnderCaps = (
  flags: JutsuCapFlags,
  equippedCounts: JutsuCapCounts,
) =>
  JUTSU_EQUIP_CAPS.every((cap) => !flags[cap.key] || equippedCounts[cap.key] < cap.max);

/** First exceeded normal-equip cap for error messaging, if any. */
export const findExceededJutsuEquipCap = (
  flags: JutsuCapFlags,
  equippedCounts: JutsuCapCounts,
): (JutsuEquipCap & { label: string }) | undefined => {
  const cap = JUTSU_EQUIP_CAPS.find(
    (c) => flags[c.key] && equippedCounts[c.key] >= c.max,
  );
  if (!cap) return undefined;
  return { ...cap, label: getJutsuCategoryDef(cap.key).label };
};

type JutsuLoadoutValidationInput = Pick<UserJutsuWithRelations, "jutsuId" | "jutsu">;

/**
 * Apply ownership, caller-specific eligibility, total-slot, and category-cap
 * validation to an ordered list of saved jutsu IDs. Keeping the cap pass here
 * ensures every loadout-selection surface, including the combat lobby, uses
 * the same rules as manual equip.
 */
export const computeJutsuLoadoutCapAssignments = (args: {
  jutsuIds: string[];
  userjutsus: JutsuLoadoutValidationInput[];
  maxEquip: number;
  validateJutsu?: (userJutsu: JutsuLoadoutValidationInput) => string | undefined;
}): ComputedJutsuLoadout => {
  const { jutsuIds, userjutsus, maxEquip, validateJutsu } = args;
  const equipIds: string[] = [];
  const invalidJutsus: string[] = [];
  const counts = emptyCapCounts();

  // A jutsu is equipped or not (no quantity), and the equip CASE matches by
  // jutsuId, so duplicates must not consume slots or category capacity.
  const uniqueJutsuIds = [...new Set(jutsuIds)];

  jutsuLoop: for (const jutsuId of uniqueJutsuIds) {
    const userJutsu = userjutsus.find((entry) => entry.jutsuId === jutsuId);
    if (!userJutsu) {
      invalidJutsus.push("Jutsu not found");
      continue;
    }

    const validationError = validateJutsu?.(userJutsu);
    if (validationError) {
      invalidJutsus.push(validationError);
      continue;
    }

    const flags = getJutsuCapFlags(userJutsu.jutsu);
    if (equipIds.length >= maxEquip) {
      invalidJutsus.push(`${userJutsu.jutsu.name}: equip limit reached`);
      continue;
    }
    for (const cap of JUTSU_EQUIP_CAPS) {
      if (flags[cap.key] && counts[cap.key] >= cap.max) {
        invalidJutsus.push(
          `${userJutsu.jutsu.name}: ${getJutsuCategoryDef(cap.key).label} jutsu limit reached`,
        );
        continue jutsuLoop;
      }
    }

    equipIds.push(jutsuId);
    for (const cap of JUTSU_EQUIP_CAPS) {
      if (flags[cap.key]) counts[cap.key] += 1;
    }
  }

  return { equipIds, invalidJutsus };
};

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
  activatedSkillIds?: ReadonlySet<string>;
}): ComputedJutsuLoadout => {
  const { jutsuIds, userjutsus, user, activatedSkillIds = new Set<string>() } = args;
  return computeJutsuLoadoutCapAssignments({
    jutsuIds,
    userjutsus,
    maxEquip: calcJutsuEquipLimit(user),
    validateJutsu: ({ jutsu }) => {
      if (jutsu.hidden && !canChangeContent(user.role)) {
        return `${jutsu.name} is hidden`;
      }
      if (!canUseJutsu(jutsu, user)) {
        return `${jutsu.name}: missing requirements`;
      }
      if (jutsu.requiredSkillId && !activatedSkillIds.has(jutsu.requiredSkillId)) {
        return `${jutsu.name}: required skill is not active`;
      }
      return undefined;
    },
  });
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
