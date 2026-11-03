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

/**
 * All jutsu category predicates (normal equip + ranked-only). Single definition of
 * what counts as residual / heal / poison / etc. so equip and ranked caps stay aligned.
 */
const namedCategories = [
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
    key: "isParry",
    label: "parry",
    matches: (jutsu: JutsuCapMatchInput) =>
      jutsu.effects.some((e) => e.type === "parry"),
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

export const JUTSU_CATEGORY_DEFS: {
  key: string;
  label: string;
  matches: (jutsu: JutsuCapMatchInput) => boolean;
}[] = [
  ...namedCategories,
  ...tagTypes
    .filter(
      (tag) =>
        !namedCategories.some(
          (def) =>
            def.label === tag ||
            (tag === "pierce" && def.key === "isPierce") ||
            (tag === "increasepoolcost" && def.key === "isIncreaseCost"),
        ),
    )
    .map((tag) => ({
      key: tag,
      label: tag,
      matches: (jutsu: JutsuCapMatchInput) =>
        jutsu.effects.some((effect) => effect.type === tag),
    })),
];

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

export type JutsuEquipCap = {
  key: string;
  max: number;
  countAlias: string;
  sql:
    | { kind: "residual" }
    | { kind: "effect"; effectType: string }
    | { kind: "jutsuType"; jutsuType: string };
};

/** Resolve the applicable limits; null explicitly means unlimited. */
export const buildJutsuEquipCaps = (
  rules: JutsuEquipLimit[],
  mode: "ranked" | "unranked",
): JutsuEquipCap[] =>
  rules.flatMap((rule, index) => {
    const max = mode === "ranked" ? rule.rankedMaxEquipped : rule.unrankedMaxEquipped;
    if (max === null) return [];
    const special = rule.category;
    const tag =
      special === "increasepoolcost"
        ? "increasecost"
        : special === "pierce"
          ? "piercing"
          : special;
    const def = JUTSU_CATEGORY_DEFS.find(
      (entry) => entry.label === special || entry.label === tag,
    );
    if (!def) throw new Error("Unknown equip limit category");
    return [
      {
        key: def.key,
        max,
        countAlias: `cap_${index}`,
        sql:
          special === "residual"
            ? { kind: "residual" as const }
            : special === "event" || special === "forbidden"
              ? { kind: "jutsuType" as const, jutsuType: special.toUpperCase() }
              : {
                  kind: "effect" as const,
                  effectType: special,
                },
      },
    ];
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
    const flags = getJutsuCapFlags(uj.jutsu);
    for (const cap of caps) {
      if (flags[cap.key]) counts[cap.key] = (counts[cap.key] ?? 0) + 1;
    }
  }
  return counts;
};

/** Whether `flags` fit under `equippedCounts` for every normal-equip capped category. */
export const canEquipUnderCaps = (
  flags: JutsuCapFlags,
  equippedCounts: JutsuCapCounts,
  caps: JutsuEquipCap[],
) => caps.every((cap) => !flags[cap.key] || (equippedCounts[cap.key] ?? 0) < cap.max);

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

  jutsuLoop: for (const jutsuId of uniqueJutsuIds) {
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
    for (const cap of caps) {
      if (flags[cap.key] && (counts[cap.key] ?? 0) >= cap.max) {
        exclude(
          jutsuId,
          `${userJutsu.jutsu.name}: ${getJutsuCategoryDef(cap.key).label} jutsu limit reached`,
          "equip-limit",
        );
        continue jutsuLoop;
      }
    }

    equipIds.push(jutsuId);
    for (const cap of caps) {
      if (flags[cap.key]) counts[cap.key] = (counts[cap.key] ?? 0) + 1;
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
