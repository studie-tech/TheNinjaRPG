import { Filter } from "lucide-react";
import type React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type {
  CombatStatType,
  ElementName,
  GeneralType,
  MasteryType,
  StatType,
} from "@/drizzle/constants";
import { DIFFUSE_MAX_PERCENTAGE, PARRY_MAX_PERCENTAGE } from "@/drizzle/constants";
import { useLocalStorage } from "@/hooks/localstorage";
import ElementImage from "@/layout/ElementImage";
import { POTENCY_TAG_LABELS } from "@/libs/combat/potency";
import { getEffectMagnitude } from "@/libs/combat/power";
import type { BattleUserState, GroundEffect, UserEffect } from "@/libs/combat/types";
import {
  getPreventTypeName,
  getStatTypeLabels,
  isEffectActive,
  sealCheck,
} from "@/libs/combat/util";
import { cn } from "@/libs/shadui";
import { isNegativeUserEffect, isPositiveUserEffect } from "@/validators/combat";

type EffectCategory =
  | GeneralType
  | StatType
  | CombatStatType
  | MasteryType
  | ElementName
  | "All";

type CollapsedEffect = {
  type: string;
  value: number;
  calculation: "static" | "percentage" | "formula";
  category: EffectCategory;
  upDownEffect: boolean;
  /** Direction of the first collapsed modifier, for rows a seal zeroes out. */
  direction: 1 | -1;
  rounds: number[];
  sealed: boolean;
  blocks?: string; // For immunity effects
  detail?: string; // Keeps potency tags and aggro modes apart
  instanceId?: string; // Preserves modifiers whose application order matters
  detailElements?: string; // ...and for different element selections
};

/** Tags that only drive visuals, actions or one-off placement, so they have no lasting row. */
const UNLISTED_TYPES = new Set([
  "visual",
  "injectjutsus",
  "activatesagemode",
  "move",
  "clone",
  "summon",
  "barrier",
  "flee",
]);

/** Plain-language damage modifier sections, with the abbreviations players use. */
const DAMAGE_MODIFIER_SECTIONS = [
  {
    type: "damagegiven",
    increase: true,
    good: true,
    label: "Damage Given Buffs",
    abbr: "DGB",
  },
  {
    type: "damagegiven",
    increase: false,
    good: false,
    label: "Damage Given Reduction",
    abbr: "DGR",
  },
  {
    type: "damagetaken",
    increase: false,
    good: true,
    label: "Damage Taken Reduction",
    abbr: "DTR",
  },
  {
    type: "damagetaken",
    increase: true,
    good: false,
    label: "Damage Taken Increase",
    abbr: "DTI",
  },
] as const;

const SOURCE_FILTERS = [
  { id: "jutsu", label: "Jutsu" },
  { id: "armor", label: "Armor" },
  { id: "item", label: "Item" },
  { id: "bloodline", label: "Bloodline" },
  { id: "village", label: "Village" },
  { id: "skill", label: "Skill" },
] as const;

interface VisualizeEffectsProps {
  effects: UserEffect[];
  userId: string;
  diffuseDamage?: BattleUserState["diffuseDamage"];
}

/** Summarize active user effects by source and polarity, including diffuse damage. */
export const VisualizeEffects: React.FC<VisualizeEffectsProps> = ({
  effects,
  userId,
  diffuseDamage = [],
}) => {
  // ------------- Toggle states -------------
  const [includeJutsu, setIncludeJutsu] = useLocalStorage<boolean>(
    "ve_include_jutsu",
    true,
  );
  const [includeArmor, setIncludeArmor] = useLocalStorage<boolean>(
    "ve_include_armor",
    true,
  );
  const [includeItem, setIncludeItem] = useLocalStorage<boolean>(
    "ve_include_item",
    true,
  );
  const [includeBloodline, setIncludeBloodline] = useLocalStorage<boolean>(
    "ve_include_bloodline",
    true,
  );
  const [includeVillage, setIncludeVillage] = useLocalStorage<boolean>(
    "ve_include_village",
    true,
  );
  const [includeSkill, setIncludeSkill] = useLocalStorage<boolean>(
    "ve_include_skill",
    true,
  );

  const includeEffect = (type?: UserEffect["fromType"]): boolean => {
    if (!type) return true;
    switch (type) {
      case "jutsu":
        return includeJutsu;
      case "armor":
        return includeArmor;
      case "item":
        return includeItem;
      case "bloodline":
        return includeBloodline;
      case "village":
        return includeVillage;
      case "skill":
        return includeSkill;
      default:
        return true;
    }
  };

  // Filter effects before processing
  const filteredEffects = effects.filter((e) => includeEffect(e.fromType));
  // Effects on this character that the source filter currently hides
  const hiddenEffects = effects.filter(
    (e) =>
      !includeEffect(e.fromType) &&
      e.targetId === userId &&
      isEffectActive(e) &&
      !UNLISTED_TYPES.has(e.type),
  );
  const sourceToggles = {
    jutsu: [includeJutsu, setIncludeJutsu],
    armor: [includeArmor, setIncludeArmor],
    item: [includeItem, setIncludeItem],
    bloodline: [includeBloodline, setIncludeBloodline],
    village: [includeVillage, setIncludeVillage],
    skill: [includeSkill, setIncludeSkill],
  } as const;
  const hiddenSources = SOURCE_FILTERS.filter(({ id }) => !sourceToggles[id][0]);
  const showAllSources = () =>
    Object.values(sourceToggles).forEach(([checked, set]) => {
      if (!checked) set(true);
    });

  // Get sealing effects among the filtered ones (used for strike-through calculation)
  const sealEffects = filteredEffects.filter((e) => e.type === "seal" && !e.isNew);

  // Collapse consequences based on their type & calculation type
  const collapsedEffects: CollapsedEffect[] = filteredEffects
    .filter(isEffectActive)
    .filter((e) => e.targetId === userId)
    .filter((e) => e.rounds === undefined || e.rounds > 0)
    .reduce((acc, val) => {
      const masteryTypes = ("masteryTypes" in val && val?.masteryTypes) || [];
      const stats = [
        ...getStatTypeLabels(val),
        ...masteryTypes,
        ...(("generalTypes" in val && val?.generalTypes) || []),
        ...(("elements" in val && val?.elements) || []),
        ...(("actionsAffected" in val && val?.actionsAffected) || []),
        ...(("poolsAffected" in val && val?.poolsAffected) || []),
      ];
      const isSealed = sealCheck(val, sealEffects);
      let cats = stats.length === 0 ? ["All"] : stats;
      const JUTSU_CATS = ["Taijutsu", "Ninjutsu", "Genjutsu", "Bukijutsu"];
      // Masteries also span Bloodline and Sage, so four jutsu masteries are not "All".
      if (masteryTypes.length === 0 && JUTSU_CATS.every((jc) => cats.includes(jc))) {
        cats = cats.filter((c) => !JUTSU_CATS.includes(c));
        cats.push("All");
      }
      const dual = val.type.includes("increase") || val.type.includes("decrease");
      let baseType = dual
        ? val.type.replace("increase", "").replace("decrease", "")
        : val.type;
      // Normalize maxpools to pools for display
      if (baseType === "maxpools") {
        baseType = "pools";
      }
      const sign: 1 | -1 = val.type.includes("decrease") ? -1 : 1;

      // Clean, targeted handling for wound effects only
      let value: number;

      if (val.type === "wound" && val.timeTracker?.originalDamage !== undefined) {
        // Convert wound percentage to actual damage amount
        const woundPower = getEffectMagnitude(val);
        const od = val.timeTracker.originalDamage || 0;
        value = -Math.floor(od * (woundPower / 100));
      } else {
        // Standard processing for all other effects
        value = getEffectMagnitude(val) * sign;
        if (val.type === "diffuse") value = Math.min(DIFFUSE_MAX_PERCENTAGE, value);
      }
      const detail =
        "aggroMode" in val
          ? val.aggroMode
          : "affectedTag" in val && typeof val.affectedTag === "string"
            ? val.affectedTag
            : undefined;
      // Pool costs and current enmity apply sequentially, so additive totals are misleading.
      const instanceId =
        baseType === "poolcost" || (baseType === "aggro" && detail === "ENMITY")
          ? val.id
          : undefined;
      // Potency only boosts tags of its selected elements, like getEffectStackKey.
      const detailElements =
        "affectedElements" in val && Array.isArray(val.affectedElements)
          ? [...new Set(val.affectedElements as string[])].sort().join(", ")
          : "";
      cats.forEach((cat) => {
        const valBlocks = "blocks" in val ? (val.blocks as string) : undefined;
        const found = acc.find(
          (e: CollapsedEffect) =>
            e.type === baseType &&
            e.calculation === val.calculation &&
            e.category === cat &&
            e.sealed === isSealed &&
            e.blocks === valBlocks &&
            e.detail === detail &&
            e.instanceId === instanceId &&
            (e.detailElements ?? "") === detailElements,
        );
        if (found) {
          // Diffuse uses the strongest active percentage rather than adding effects.
          found.value =
            val.type === "diffuse" ? Math.max(found.value, value) : found.value + value;
          if (val.type === "parry") {
            found.value = Math.min(PARRY_MAX_PERCENTAGE, found.value);
          }
          if (val.rounds) found.rounds.push(val.rounds);
        } else {
          acc.push({
            type: baseType,
            value: isSealed ? 0 : value,
            category: cat as EffectCategory,
            calculation: val.calculation,
            upDownEffect: dual,
            direction: sign,
            rounds: val.rounds ? [val.rounds] : [],
            sealed: isSealed,
            blocks: valBlocks,
            detail,
            instanceId,
            detailElements,
          });
        }
      });
      return acc;
    }, [] as CollapsedEffect[]);

  // ------------ UI helpers ------------
  const valueTxt = (e: CollapsedEffect) => {
    // Wound values are already converted to damage amounts
    const pct = e.type !== "wound" && e.calculation === "percentage" ? "%" : "";
    return `${e.value > 0 ? "+" : ""}${Math.round(e.value)}${pct}`;
  };
  const roundsTxt = (e: CollapsedEffect) =>
    e.rounds.length > 0 ? `↻ ${Math.max(...e.rounds)}` : "";

  const renderCompact = (e: CollapsedEffect, i: number) => {
    // Damage modifiers use renderMagnitude; for everything here, more is good
    const isPositiveEffect = e.value > 0;

    return (
      <div
        key={`${i}-${e.type}-${e.category}-${e.blocks || ""}`}
        className="flex flex-row items-center gap-2"
      >
        <ElementImage element={e.category} className="h-6 w-6 shrink-0" />
        <div className="flex flex-col leading-none">
          <div
            className={cn(
              isPositiveEffect ? "text-green-500" : "text-red-500",
              e.sealed && "line-through",
            )}
          >
            {valueTxt(e)}
          </div>
          {roundsTxt(e) && <div className="text-xs">{roundsTxt(e)}</div>}
        </div>
      </div>
    );
  };

  /** Section headings carry the direction, so rows show only the size of the change. */
  const renderMagnitude = (e: CollapsedEffect, i: number, good: boolean) => {
    const pct = e.calculation === "percentage" ? "%" : "";
    return (
      <div
        key={`${i}-${e.type}-${e.category}-${e.sealed}`}
        className="flex flex-row items-center gap-2"
      >
        <ElementImage element={e.category} className="h-6 w-6 shrink-0" />
        <div className="flex flex-col leading-none">
          <div
            className={cn(
              good ? "text-green-500" : "text-red-500",
              e.sealed && "line-through",
            )}
          >
            {`${Math.abs(Math.round(e.value))}${pct}`}
          </div>
          {roundsTxt(e) && <div className="text-xs">{roundsTxt(e)}</div>}
        </div>
      </div>
    );
  };

  // ------------ Categorisation ------------
  const STATUS_TYPES = new Set([
    "shield",
    "diffuse",
    "absorb",
    "reflect",
    "parry",
    "curse",
    "recoil",
    "afterburn",
    "drain",
    "poison",
    "lifesteal",
    "fleeprevent",
    "robprevent",
    "buffprevent",
    "debuffprevent",
    "clearprevent",
    "cleanseprevent",
    "healprevent",
    "stunprevent",
    "moveprevent",
    "sealprevent",
    "range",
    "onehitkillprevent",
    "summonprevent",
    "disarm",
    "immunity",
    "seal",
    "stun",
    "stealth",
    "finalstand",
    "clear",
    "cleanse",
    "timecompression",
    "timedilation",
    "redirection",
    "pools",
  ]);

  // Calculate net multiplicative heal given effects
  const decreaseHealEffects = filteredEffects.filter(
    (e) =>
      e.type === "decreaseheal" &&
      e.calculation === "percentage" &&
      e.targetId === userId &&
      isEffectActive(e) &&
      !sealCheck(e, sealEffects),
  );
  const increaseHealEffects = filteredEffects.filter(
    (e) =>
      e.type === "increaseheal" &&
      e.calculation === "percentage" &&
      e.targetId === userId &&
      isEffectActive(e) &&
      !sealCheck(e, sealEffects),
  );

  let healGivenEffects: CollapsedEffect[] = [];
  if (decreaseHealEffects.length > 0 || increaseHealEffects.length > 0) {
    // Calculate net multiplicative effect
    let netFactor = 1;

    // Apply all decrease effects multiplicatively
    decreaseHealEffects.forEach((e) => {
      const power = getEffectMagnitude(e);
      netFactor *= 1 - power / 100; // decrease = 1 - percentage
    });

    // Apply all increase effects multiplicatively
    increaseHealEffects.forEach((e) => {
      const power = getEffectMagnitude(e);
      netFactor *= 1 + power / 100; // increase = 1 + percentage
    });

    const netPercentage = (netFactor - 1) * 100;

    healGivenEffects = [
      {
        type: "heal",
        value: netPercentage,
        category: "All" as EffectCategory,
        calculation: "percentage" as const,
        upDownEffect: true,
        direction: netPercentage < 0 ? -1 : 1,
        rounds: [],
        sealed: false,
      },
    ];
  }

  const statusEffects = collapsedEffects.filter((e) => STATUS_TYPES.has(e.type));
  // Net increases and decreases get their own plainly named sections instead of signs.
  const isIncrease = (e: CollapsedEffect) =>
    e.value !== 0 ? e.value > 0 : e.direction > 0;
  const damageModifierSections = DAMAGE_MODIFIER_SECTIONS.map((section) => ({
    ...section,
    effects: collapsedEffects.filter(
      (e) => e.type === section.type && isIncrease(e) === section.increase,
    ),
  })).filter((section) => section.effects.length > 0);
  const statEffects = collapsedEffects.filter((e) => e.type === "stat");
  const masteryEffects = collapsedEffects.filter((e) => e.type === "mastery");
  const damageEffects = collapsedEffects.filter(
    (e) => e.type === "damage" || e.type === "wound",
  );
  // Everything else still active (potency, pool cost, aggro, regeneration, ...)
  const listedTypes = new Set([
    ...STATUS_TYPES,
    "damagegiven",
    "damagetaken",
    "stat",
    "mastery",
    "damage",
    "wound",
  ]);
  const otherEffects = collapsedEffects.filter(
    (e) =>
      !listedTypes.has(e.type) &&
      !UNLISTED_TYPES.has(e.type) &&
      // Percentage heal modifiers are summarized under Heal Given
      !(e.type === "heal" && e.upDownEffect && e.calculation === "percentage"),
  );

  const statusLabel: Record<string, string> = {
    reflect: "Reflect",
    parry: "Parry",
    curse: "Curse healing power",
    diffuse: "Diffuse",
    shield: "Shield",
    absorb: "Absorb",
    recoil: "Recoil",
    afterburn: "Afterburn",
    drain: "Drain",
    poison: "Poison",
    lifesteal: "Lifesteal",
    range: "Range",
    fleeprevent: "Cannot Flee",
    robprevent: "Cannot be Robbed",
    buffprevent: "Cannot be Buffed",
    debuffprevent: "Cannot be Debuffed",
    clearprevent: "Cannot be Cleared",
    cleanseprevent: "Cannot be Cleansed",
    healprevent: "Cannot be Healed",
    stunprevent: "Cannot be Stunned",
    moveprevent: "Immobilized",
    sealprevent: "Cannot be Sealed",
    onehitkillprevent: "Cannot be OHKO'd",
    summonprevent: "Cannot Summon",
    disarm: "Disarmed",
    immunity: "Immunity",
    seal: "BL Sealed",
    stun: "Stunned",
    stealth: "Stealthed",
    finalstand: "Final Stand",
    clear: "Clear Positives",
    cleanse: "Cleanse Debuffs",
    timecompression: "Time Compression",
    timedilation: "Time Dilation",
    redirection: "Redirection",
    pools: "Pool",
  };

  const getEffectLabel = (e: (typeof statusEffects)[number]) => {
    if (e.type === "immunity" && "blocks" in e && e.blocks) {
      const preventType = getPreventTypeName(e.blocks as string);
      return `Immune to ${preventType.charAt(0).toUpperCase() + preventType.slice(1)} Prevent`;
    }
    return statusLabel[e.type] || e.type;
  };

  const otherLabel: Record<string, string> = {
    aggro: "Aggro",
    poolcost: "Pool Cost",
    potency: "Potency",
    regeneration: "Regeneration",
    heal: "Heal",
    pierce: "Pierce",
    consume: "Consume",
    elementaldamage: "Elemental Damage",
    weakness: "Weakness",
    siphon: "Siphon",
    vamp: "Vamp",
    mirror: "Mirror",
    copy: "Copy",
    rob: "Rob",
    onehitkill: "One-Hit Kill",
    jutsuslots: "Jutsu Slots",
  };
  /** Use the shared player-facing potency names while retaining scope details. */
  const getOtherLabel = (e: CollapsedEffect) => {
    const label =
      otherLabel[e.type] ?? `${e.type.charAt(0).toUpperCase()}${e.type.slice(1)}`;
    if (e.type === "aggro") {
      return `${label} (${e.detail === "ENMITY" ? "Current Enmity" : "Generation"})`;
    }
    if (e.type !== "potency") return label;
    const parts = [
      ...(e.detail && e.detail !== "all"
        ? [POTENCY_TAG_LABELS[e.detail as keyof typeof POTENCY_TAG_LABELS] ?? e.detail]
        : []),
      ...(e.detailElements ? [e.detailElements] : []),
    ];
    return parts.length > 0 ? `${label} (${parts.join(", ")})` : label;
  };

  const otherVisuals = otherEffects.map((e) => (
    <div
      key={`${e.type}-${e.category}-${e.calculation}-${e.sealed}-${e.detail || ""}-${e.detailElements || ""}-${e.instanceId || ""}`}
      className="flex flex-row items-center gap-2 text-xs"
    >
      <ElementImage element={e.category} className="h-6 w-6 shrink-0" />
      <div
        className={cn(e.sealed && "line-through")}
      >{`${getOtherLabel(e)} ${valueTxt(e)} ${roundsTxt(e)}`}</div>
    </div>
  ));

  const statusVisuals = statusEffects.map((e) => (
    <div
      key={`${e.type}-${e.category}-${e.blocks || ""}`}
      className="flex flex-row items-center gap-2 text-xs"
    >
      <ElementImage element={e.category} className="h-6 w-6 shrink-0" />
      <div
        className={cn(e.sealed && "line-through")}
      >{`${getEffectLabel(e)} ${valueTxt(e)} ${roundsTxt(e)}`}</div>
    </div>
  ));

  const activeCurses = filteredEffects.filter(
    (effect) =>
      effect.type === "curse" &&
      effect.targetId === userId &&
      isEffectActive(effect) &&
      effect.curseState &&
      !effect.curseState.settled,
  );
  const pendingDiffuseDamage = diffuseDamage.filter((debt) => debt.remainingTurns > 0);
  const diffuseDebt = pendingDiffuseDamage.reduce(
    (sum, debt) => sum + debt.remainingDamage,
    0,
  );
  const nextDiffuseRepayment = pendingDiffuseDamage.reduce(
    (sum, debt) => sum + debt.remainingDamage / debt.remainingTurns,
    0,
  );
  const diffuseTurns = Math.max(
    0,
    ...pendingDiffuseDamage.map((debt) => debt.remainingTurns),
  );

  // ------------ Render ------------
  return (
    <div
      className={cn(
        "@container relative flex flex-col gap-4 text-base md:text-xs lg:text-base",
        // The filter needs space even when all of the battle's effects have expired.
        effects.length > 0 && "min-h-5",
      )}
    >
      {effects.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Filter effects by source"
              className={cn(
                "focus-visible:ring-ring absolute top-0 right-0 h-5 w-5 rounded-sm hover:cursor-pointer hover:text-orange-500 focus-visible:ring-2 focus-visible:outline-none",
                hiddenSources.length > 0 && "text-orange-500",
              )}
            >
              <Filter className="h-5 w-5" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-max p-2 text-xs">
            <div className="flex flex-col gap-2">
              {SOURCE_FILTERS.map(({ id, label }) => {
                const [checked, onChange] = sourceToggles[id];
                return (
                  <div key={id} className="flex items-center gap-2">
                    <Switch
                      id={`ve-toggle-${id}`}
                      checked={checked}
                      onCheckedChange={onChange}
                    />
                    <label htmlFor={`ve-toggle-${id}`}>{label}</label>
                  </div>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {hiddenEffects.length > 0 && (
        <div className="pr-6 text-orange-500 text-xs">
          {hiddenEffects.length} {hiddenEffects.length === 1 ? "effect" : "effects"}{" "}
          hidden by the {hiddenSources.map((s) => s.label).join(", ")} filter.{" "}
          <button
            type="button"
            className="underline hover:cursor-pointer"
            onClick={showAllSources}
          >
            Show all
          </button>
        </div>
      )}

      {statusVisuals.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Statuses</div>
          <div className="flex flex-col gap-1">{statusVisuals}</div>
        </div>
      )}

      {/* Ground seals are projected during combat processing, so show configuration here. */}
      {activeCurses.map((effect) => (
        <div key={`stored-${effect.id}`}>
          <div className="mb-1 font-semibold">Curse Healing</div>
          <div>
            {effect.curseState?.storedHealing.toFixed(2)} HP stored · {effect.rounds}{" "}
            {effect.rounds === 1 ? "round" : "rounds"} remaining
          </div>
          {effect.type === "curse" && (
            <div className="text-xs">
              Configured damage bonus: +{effect.damageBonusPercent ?? 0}%
            </div>
          )}
        </div>
      ))}

      {diffuseDebt > 0 && (
        <div>
          <div className="mb-1 font-semibold">Deferred Damage</div>
          <div className="text-red-500 text-xs">
            {diffuseDebt.toFixed(2)} HP over {diffuseTurns}{" "}
            {diffuseTurns === 1 ? "turn" : "turns"}
          </div>
          <div className="text-xs">
            Next repayment: {nextDiffuseRepayment.toFixed(2)} HP
          </div>
        </div>
      )}

      {damageModifierSections.map((section) => (
        <section key={section.abbr} aria-label={section.label}>
          {/* Wide panels name the section in full; narrow ones lead with the
              abbreviation and spell it out below, since touch has no hover. */}
          <div className="mb-1">
            <div className="flex items-baseline gap-x-1.5 font-semibold">
              <span className="hidden @min-[15rem]:inline">{section.label}</span>
              <abbr
                title={section.label}
                className="no-underline @min-[15rem]:text-xs @min-[15rem]:font-normal @min-[15rem]:opacity-70"
              >
                {section.abbr}
              </abbr>
            </div>
            <div aria-hidden className="text-xs opacity-80 @min-[15rem]:hidden">
              {section.label}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {section.effects.map((e, i) => renderMagnitude(e, i, section.good))}
          </div>
        </section>
      ))}

      {healGivenEffects.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Heal Given</div>
          <div className="grid grid-cols-2 gap-1">
            {healGivenEffects.map(renderCompact)}
          </div>
        </div>
      )}

      {statEffects.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Stats</div>
          <div className="grid grid-cols-2 gap-1">{statEffects.map(renderCompact)}</div>
        </div>
      )}

      {masteryEffects.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Masteries</div>
          <div className="grid grid-cols-2 gap-1">
            {masteryEffects.map(renderCompact)}
          </div>
        </div>
      )}

      {damageEffects.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Residual Damage</div>
          <div className="grid grid-cols-2 gap-1">
            {damageEffects.map(renderCompact)}
          </div>
        </div>
      )}

      {otherVisuals.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Other Effects</div>
          <div className="flex flex-col gap-1">{otherVisuals}</div>
        </div>
      )}
    </div>
  );
};

/**
 * Shared effect row component for rendering individual effects
 */
interface EffectRowProps {
  type: string;
  power: number;
  calculation?: string;
  roundsLeft: number;
  isPositive: boolean;
  isNegative: boolean;
}

const EffectRow: React.FC<EffectRowProps> = ({
  type,
  power,
  calculation,
  roundsLeft,
  isPositive,
  isNegative,
}) => {
  const colorClass = isPositive
    ? "text-green-500"
    : isNegative
      ? "text-red-500"
      : "text-gray-400";
  return (
    <div
      className={cn(
        "flex flex-row items-center justify-between gap-2 text-xs",
        colorClass,
      )}
    >
      <span className="capitalize">{type.replace(/([A-Z])/g, " $1").trim()}</span>
      <span className="flex gap-2">
        {power > 0 && (
          <span>
            {isNegative ? "-" : "+"}
            {power}
            {calculation === "percentage" ? "%" : ""}
          </span>
        )}
        {roundsLeft > 0 && <span className="text-gray-400">↻{roundsLeft}</span>}
      </span>
    </div>
  );
};

interface VisualizeGroundEffectsProps {
  effects: GroundEffect[];
}

/** Group visible ground effects into buffs, debuffs and neutral effects. */
export const VisualizeGroundEffects: React.FC<VisualizeGroundEffectsProps> = ({
  effects,
}) => {
  if (effects.length === 0) return null;

  const classified = effects.map((effect) => ({
    effect,
    isPositive: isPositiveUserEffect(effect),
    isNegative: isNegativeUserEffect(effect),
  }));
  const positiveEffects = classified.filter((c) => c.isPositive);
  const negativeEffects = classified.filter((c) => !c.isPositive && c.isNegative);
  const neutralEffects = classified.filter((c) => !c.isPositive && !c.isNegative);

  const renderEffect = (
    { effect, isPositive, isNegative }: (typeof classified)[number],
    index: number,
  ) => (
    <EffectRow
      key={`${effect.id}-${index}`}
      type={effect.type}
      power={getEffectMagnitude(effect)}
      calculation={effect.calculation}
      roundsLeft={effect.rounds ?? 0}
      isPositive={isPositive}
      isNegative={isNegative}
    />
  );

  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="font-semibold text-gray-500 text-xs uppercase">
        Ground Effects
      </div>
      {positiveEffects.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="font-medium text-green-600 text-xs">Buffs</div>
          {positiveEffects.map(renderEffect)}
        </div>
      )}
      {negativeEffects.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="font-medium text-red-600 text-xs">Debuffs</div>
          {negativeEffects.map(renderEffect)}
        </div>
      )}
      {neutralEffects.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="font-medium text-gray-500 text-xs">Other</div>
          {neutralEffects.map(renderEffect)}
        </div>
      )}
    </div>
  );
};
