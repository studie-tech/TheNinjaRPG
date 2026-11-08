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
  rounds: number[];
  sealed: boolean;
  blocks?: string; // For immunity effects
};

interface VisualizeEffectsProps {
  effects: UserEffect[];
  userId: string;
  diffuseDamage?: BattleUserState["diffuseDamage"];
}

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
      const sign = val.type.includes("decrease") ? -1 : 1;

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
      cats.forEach((cat) => {
        const valBlocks = "blocks" in val ? (val.blocks as string) : undefined;
        const found = acc.find(
          (e: CollapsedEffect) =>
            e.type === baseType &&
            e.calculation === val.calculation &&
            e.category === cat &&
            e.sealed === isSealed &&
            e.blocks === valBlocks,
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
            rounds: val.rounds ? [val.rounds] : [],
            sealed: isSealed,
            blocks: valBlocks,
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
    // Less damage taken is good; for everything else, more is good
    const isPositiveEffect = e.type === "damagetaken" ? e.value < 0 : e.value > 0;

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
        rounds: [],
        sealed: false,
      },
    ];
  }

  const statusEffects = collapsedEffects.filter((e) => STATUS_TYPES.has(e.type));
  const damageGivenEffects = collapsedEffects.filter((e) => e.type === "damagegiven");
  const damageTakenEffects = collapsedEffects.filter((e) => e.type === "damagetaken");
  const statEffects = collapsedEffects.filter((e) => e.type === "stat");
  const masteryEffects = collapsedEffects.filter((e) => e.type === "mastery");
  const damageEffects = collapsedEffects.filter(
    (e) => e.type === "damage" || e.type === "wound",
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
        "relative flex flex-col gap-4 text-base md:text-xs lg:text-base",
        // The filter needs space even when all of the battle's effects have expired.
        effects.length > 0 && "min-h-5",
      )}
    >
      {effects.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Filter className="absolute top-0 right-0 h-5 w-5 hover:cursor-pointer hover:text-orange-500" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-max p-2 text-xs">
            <div className="flex flex-col gap-2">
              {[
                {
                  id: "jutsu",
                  label: "Jutsu",
                  checked: includeJutsu,
                  onChange: setIncludeJutsu,
                },
                {
                  id: "armor",
                  label: "Armor",
                  checked: includeArmor,
                  onChange: setIncludeArmor,
                },
                {
                  id: "item",
                  label: "Item",
                  checked: includeItem,
                  onChange: setIncludeItem,
                },
                {
                  id: "bloodline",
                  label: "Bloodline",
                  checked: includeBloodline,
                  onChange: setIncludeBloodline,
                },
                {
                  id: "village",
                  label: "Village",
                  checked: includeVillage,
                  onChange: setIncludeVillage,
                },
                {
                  id: "skill",
                  label: "Skill",
                  checked: includeSkill,
                  onChange: setIncludeSkill,
                },
              ].map(({ id, label, checked, onChange }) => (
                <div key={id} className="flex items-center gap-2">
                  <Switch
                    id={`ve-toggle-${id}`}
                    checked={checked}
                    onCheckedChange={onChange}
                  />
                  <label htmlFor={`ve-toggle-${id}`}>{label}</label>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
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

      {damageGivenEffects.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Damage Given</div>
          <div className="grid grid-cols-2 gap-1">
            {damageGivenEffects.map(renderCompact)}
          </div>
        </div>
      )}

      {damageTakenEffects.length > 0 && (
        <div>
          <div className="mb-1 font-semibold">Damage Taken</div>
          <div className="grid grid-cols-2 gap-1">
            {damageTakenEffects.map(renderCompact)}
          </div>
        </div>
      )}

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

/** Ground effects grouped into buffs, debuffs and other effects */
interface VisualizeGroundEffectsProps {
  effects: GroundEffect[];
}

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
