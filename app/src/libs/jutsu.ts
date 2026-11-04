import type { FederalStatus } from "@/drizzle/constants";
import {
  JUTSU_TRANSFER_FREE_AMOUNT,
  JUTSU_TRANSFER_FREE_GOLD,
  JUTSU_TRANSFER_FREE_NORMAL,
  JUTSU_TRANSFER_FREE_SILVER,
} from "@/drizzle/constants";
import type { Jutsu, UserJutsuWithRelations } from "@/drizzle/schema";
import { applyLinkedJutsuReskin } from "@/libs/jutsu/reskins";
import type { MasteryStatSource } from "@/libs/mastery";
import { calcJutsuEquipLimit, canUseJutsu } from "@/libs/train";
import type { UserWithRelations } from "@/routers/profile";
import { canChangeContent } from "@/utils/permissions";
import { tagTypes } from "@/validators/combat";
import type { JutsuEquipLimit } from "@/validators/jutsuEquipLimit";

/**
 * Get the number of free jutsu level transfers based on the federal status
 * @param federalStatus
 * @returns
 */
/** Sort comparator for jutsu by their loadout position, with unlisted jutsu last. */
export const compareByLoadoutOrder =
  (jutsuIds: string[] = []) =>
  (a: { jutsuId: string }, b: { jutsuId: string }) => {
    const aIndex = jutsuIds.indexOf(a.jutsuId);
    const bIndex = jutsuIds.indexOf(b.jutsuId);
    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  };

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

/** Machine-readable rejection categories shown by loadout sharing previews. */
export type JutsuLoadoutExclusionReason =
  | "not-owned"
  | "unavailable"
  | "requirements"
  | "equip-limit";

/** Pair an excluded ID with its category and the existing selection diagnostic. */
type JutsuLoadoutExclusion = {
  jutsuId: string;
  reason: JutsuLoadoutExclusionReason;
  message: string;
};

type JutsuCapMatchInput = Pick<Jutsu, "effects" | "jutsuType">;

/** What puts a jutsu in a category; equip caps turn the same descriptor into SQL. */
type JutsuCategoryMatch =
  | { kind: "residual" }
  | { kind: "effect"; effectType: string }
  | { kind: "jutsuType"; jutsuType: string };

/** Category predicates shared by normal equip and ranked loadout limits. */
export const JUTSU_CATEGORY_DEFS: {
  key: string;
  label: string;
  match: JutsuCategoryMatch;
}[] = [
  {
    key: "residual",
    label: "residual",
    match: { kind: "residual" },
  },
  {
    key: "event",
    label: "event",
    match: { kind: "jutsuType", jutsuType: "EVENT" },
  },
  {
    key: "forbidden",
    label: "forbidden",
    match: { kind: "jutsuType", jutsuType: "FORBIDDEN" },
  },
  ...tagTypes.map((tag) => ({
    key: tag,
    label:
      tag === "pierce" ? "piercing" : tag === "increasepoolcost" ? "increasecost" : tag,
    match: { kind: "effect" as const, effectType: tag },
  })),
];

const matchesJutsuCategory = (match: JutsuCategoryMatch, jutsu: JutsuCapMatchInput) => {
  switch (match.kind) {
    case "residual":
      return jutsu.effects.some(
        (effect) => "residualModifier" in effect && !!effect.residualModifier,
      );
    case "jutsuType":
      return jutsu.jutsuType === match.jutsuType;
    case "effect":
      return jutsu.effects.some((effect) => effect.type === match.effectType);
  }
};

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
    JUTSU_CATEGORY_DEFS.map((def) => [def.key, matchesJutsuCategory(def.match, jutsu)]),
  ) as JutsuCapFlags;

export type JutsuEquipCap = {
  key: string;
  max: number;
  countAlias: string;
  sql: JutsuCategoryMatch;
};

/** Resolve the applicable limits; null explicitly means unlimited. */
export const buildJutsuEquipCaps = (
  rules: JutsuEquipLimit[],
  mode: "ranked" | "unranked",
): JutsuEquipCap[] =>
  rules.flatMap((rule, index) => {
    const max = mode === "ranked" ? rule.rankedMaxEquipped : rule.unrankedMaxEquipped;
    if (max === null) return [];
    const def = getJutsuCategoryDef(rule.category);
    return [{ key: def.key, max, countAlias: `cap_${index}`, sql: def.match }];
  });

export type JutsuCapCounts = Record<string, number>;

const emptyCapCounts = (caps: JutsuEquipCap[]): JutsuCapCounts =>
  Object.fromEntries(caps.map((cap) => [cap.key, 0])) as JutsuCapCounts;

/** True when any normal-equip capped category flag is set (e.g. force-unequip on evolution). */
export const hasAnyJutsuEquipCap = (flags: JutsuCapFlags, caps: JutsuEquipCap[]) =>
  caps.some((cap) => flags[cap.key]);

/** Equipped counts per normal-equip capped category. */
export const countEquippedByCap = (
  equippedJutsus: { jutsu: JutsuCapMatchInput }[],
  caps: JutsuEquipCap[],
): JutsuCapCounts => {
  const counts = emptyCapCounts(caps);
  for (const uj of equippedJutsus) {
    addCapCounts(counts, getJutsuCapFlags(uj.jutsu), caps);
  }
  return counts;
};

/** Count one more equipped jutsu against every capped category it belongs to. */
const addCapCounts = (
  counts: JutsuCapCounts,
  flags: JutsuCapFlags,
  caps: JutsuEquipCap[],
) => {
  for (const cap of caps) {
    if (flags[cap.key]) counts[cap.key] = (counts[cap.key] ?? 0) + 1;
  }
};

/** Whether `flags` fit under `equippedCounts` for every normal-equip capped category. */
export const canEquipUnderCaps = (
  flags: JutsuCapFlags,
  equippedCounts: JutsuCapCounts,
  caps: JutsuEquipCap[],
) => !findExceededJutsuEquipCap(flags, equippedCounts, caps);

/** First exceeded normal-equip cap for error messaging, if any. */
export const findExceededJutsuEquipCap = (
  flags: JutsuCapFlags,
  equippedCounts: JutsuCapCounts,
  caps: JutsuEquipCap[],
): (JutsuEquipCap & { label: string }) | undefined => {
  const cap = caps.find((c) => flags[c.key] && (equippedCounts[c.key] ?? 0) >= c.max);
  if (!cap) return undefined;
  return { ...cap, label: getJutsuCategoryDef(cap.key).label };
};

type JutsuLoadoutValidationInput = Pick<UserJutsuWithRelations, "jutsuId" | "jutsu">;

/**
 * Apply ownership, caller-specific eligibility, total-slot, and category-cap
 * validation to an ordered list of saved jutsu IDs. Keeping the cap pass here
 * ensures every loadout-selection surface, including the combat lobby, uses
 * the same rules as manual equip.
 * Optional exclusion callbacks expose categories while retaining string diagnostics.
 */
export const computeJutsuLoadoutCapAssignments = (args: {
  caps: JutsuEquipCap[];
  jutsuIds: string[];
  userjutsus: JutsuLoadoutValidationInput[];
  maxEquip: number;
  validateJutsu?: (
    userJutsu: JutsuLoadoutValidationInput,
  ) => string | Pick<JutsuLoadoutExclusion, "message" | "reason"> | undefined;
  onExcluded?: (entry: JutsuLoadoutExclusion) => void;
}): ComputedJutsuLoadout => {
  const { jutsuIds, userjutsus, maxEquip, validateJutsu, caps } = args;
  const equipIds: string[] = [];
  const invalidJutsus: string[] = [];
  const counts = emptyCapCounts(caps);
  /** Keep existing selection messages and sharing's structured exclusions in sync. */
  const exclude = (
    jutsuId: string,
    message: string,
    reason: JutsuLoadoutExclusionReason,
  ) => {
    invalidJutsus.push(message);
    args.onExcluded?.({ jutsuId, message, reason });
  };

  // A jutsu is equipped or not (no quantity), and the equip CASE matches by
  // jutsuId, so duplicates must not consume slots or category capacity.
  const uniqueJutsuIds = [...new Set(jutsuIds)];

  for (const jutsuId of uniqueJutsuIds) {
    const userJutsu = userjutsus.find((entry) => entry.jutsuId === jutsuId);
    if (!userJutsu) {
      exclude(jutsuId, "Jutsu not found", "not-owned");
      continue;
    }

    const validationError = validateJutsu?.(userJutsu);
    if (validationError) {
      exclude(
        jutsuId,
        typeof validationError === "string" ? validationError : validationError.message,
        typeof validationError === "string" ? "requirements" : validationError.reason,
      );
      continue;
    }

    const flags = getJutsuCapFlags(userJutsu.jutsu);
    if (equipIds.length >= maxEquip) {
      exclude(jutsuId, `${userJutsu.jutsu.name}: equip limit reached`, "equip-limit");
      continue;
    }
    const exceeded = findExceededJutsuEquipCap(flags, counts, caps);
    if (exceeded) {
      exclude(
        jutsuId,
        `${userJutsu.jutsu.name}: ${exceeded.label} jutsu limit reached`,
        "equip-limit",
      );
      continue;
    }

    equipIds.push(jutsuId);
    addCapCounts(counts, flags, caps);
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
  caps: JutsuEquipCap[];
  jutsuIds: string[];
  userjutsus: UserJutsuWithRelations[];
  user: NonNullable<UserWithRelations>;
  /** effectiveMasteries of the user; see canUseJutsu */
  masteries?: MasteryStatSource;
  onExcluded?: (entry: JutsuLoadoutExclusion) => void;
}): ComputedJutsuLoadout => {
  const { jutsuIds, userjutsus, user, masteries } = args;
  return computeJutsuLoadoutCapAssignments({
    jutsuIds,
    userjutsus,
    maxEquip: calcJutsuEquipLimit(user),
    caps: args.caps,
    onExcluded: args.onExcluded,
    validateJutsu: ({ jutsu }) => {
      if (jutsu.hidden && !canChangeContent(user.role)) {
        // Content and ownership reads can straddle an edit; retain the visibility category.
        return { message: `${jutsu.name} is hidden`, reason: "unavailable" };
      }
      if (!canUseJutsu(jutsu, user, false, masteries)) {
        return `${jutsu.name}: missing requirements`;
      }
      return undefined;
    },
  });
};

/**
 * Build a deduplicated, ordered preview using the shared equip rules and server names.
 * Suppress hidden/missing content names and return only accepted IDs for persistence.
 */
export const computeJutsuLoadoutPreview = (
  args: Parameters<typeof computeJutsuLoadoutAssignments>[0] & {
    content: Pick<Jutsu, "id" | "name" | "hidden">[];
  },
) => {
  const exclusions = new Map<string, JutsuLoadoutExclusion>();
  const { equipIds } = computeJutsuLoadoutAssignments({
    ...args,
    onExcluded: (entry) => exclusions.set(entry.jutsuId, entry),
  });
  const entries = [...new Set(args.jutsuIds)].map((jutsuId) => {
    const content = args.content.find((entry) => entry.id === jutsuId);
    const unavailable =
      !content || (content.hidden && !canChangeContent(args.user.role));
    const exclusion = exclusions.get(jutsuId);
    // Selection diagnostics include owned names; the preview renders its name separately.
    const prefix = `${args.userjutsus.find((entry) => entry.jutsuId === jutsuId)?.jutsu.name}: `;
    const message = exclusion?.message.startsWith(prefix)
      ? exclusion.message.slice(prefix.length)
      : exclusion?.message;
    return {
      jutsuId,
      name: unavailable ? "Unavailable jutsu" : content.name,
      accepted: !unavailable && !exclusion,
      reason: unavailable ? ("unavailable" as const) : (exclusion?.reason ?? null),
      message: unavailable
        ? "Content is unavailable"
        : exclusion?.reason === "not-owned"
          ? "Not owned"
          : (message ?? "Ready to import"),
    };
  });
  return {
    entries,
    jutsuIds: equipIds.filter((id) =>
      entries.some((e) => e.jutsuId === id && e.accepted),
    ),
  };
};

/**
 * Get the reskinned user jutsu, generic version
 * @param userJutsu
 * @returns
 */
export const getReskinnedUserJutsu = <
  T extends UserJutsuWithRelations & { linkedReskin?: Jutsu | null },
>(
  userJutsu: T,
): T => {
  userJutsu = {
    ...userJutsu,
    jutsu: applyLinkedJutsuReskin(userJutsu.jutsu, userJutsu.linkedReskin),
  };
  if (!userJutsu.activeReskin) {
    return userJutsu;
  }
  // Personal reskins override text and images; linked variants supply effect cosmetics.
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
