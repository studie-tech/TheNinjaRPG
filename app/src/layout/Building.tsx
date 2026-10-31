"use client";

import { CircleArrowUp, Info, LockKeyhole, RefreshCw } from "lucide-react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CLANS_PER_STRUCTURE_LEVEL,
  FACTION_RAID_BOOST_PERCENT,
} from "@/drizzle/constants";
import type { Village, VillageStructure } from "@/drizzle/schema";
import Confirm from "@/layout/Confirm";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import StatusBar from "@/layout/StatusBar";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { canAdministrateWars } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  calcBankInterest,
  calcStructureUpgrade,
  getEffectiveStructureLevel,
  getRaidStructureMultiplier,
} from "@/utils/village";

interface BuildingProps {
  structure: VillageStructure;
  village: Village;
  showBar?: boolean;
  textPosition: "bottom" | "right";
  showUpgrade?: boolean;
  showNumbers?: boolean;
  /** Load the first visible row immediately; other tiles load as they approach the viewport. */
  eager?: boolean;
}

const Building: React.FC<BuildingProps> = (props) => {
  // Destructure
  const { structure, village, showBar, textPosition, showUpgrade, showNumbers } = props;

  // State
  const { data: userData } = useRequiredUserData();

  // Calculate effective level (includes war victory bonus)
  const effectiveLevel = getEffectiveStructureLevel(structure);
  const delta = effectiveLevel - structure.level;

  // Blocks
  const TextBlock = (
    <div className="min-w-0 space-y-1 text-xs">
      <p className="flex min-h-8 items-center justify-center font-bold leading-tight">
        {structure.name}
      </p>
      {getRaidStructureMultiplier(structure) > 1 && (
        <p className="text-green-500">
          Raid bonus: +{FACTION_RAID_BOOST_PERCENT}% benefits until{" "}
          {new Date(structure.raidBoostExpiresAt!).toLocaleString()}
        </p>
      )}
      <div className="flex min-h-7 flex-wrap items-center justify-center gap-1">
        <p className="whitespace-nowrap">
          Lvl. {structure.level}
          {delta > 0 && <span className="text-green-500"> (+{delta})</span>}
          {delta < 0 && <span className="text-red-500"> (−{Math.abs(delta)})</span>}
        </p>{" "}
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={`${structure.name} bonuses`}
              >
                <Info className="size-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{StructureRewardEntries(structure)}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {userData && userData?.village?.kageId === userData?.userId && showUpgrade && (
          <UpgradeButton
            structure={structure}
            village={village}
            clanId={userData.clanId}
          />
        )}
        {userData && canAdministrateWars(userData.role) && (
          <RestoreStructureButton
            structureId={structure.id}
            structureName={structure.name}
          />
        )}
      </div>
    </div>
  );
  // Render
  return (
    <div className="relative flex min-w-0 flex-col items-center justify-center text-center">
      {showBar && (
        <div className="w-2/3">
          <StatusBar
            key={structure.curSp}
            title=""
            tooltip="Health"
            color="bg-red-500"
            showText={showNumbers}
            current={structure.curSp}
            total={structure.maxSp}
          />
        </div>
      )}
      <div
        className={`grid min-w-0 ${textPosition === "right" ? "grid-cols-2" : ""} items-center`}
      >
        <Link href={structure.route}>
          <Image
            className={cn(
              "aspect-square w-full object-contain object-bottom",
              structure.level > 0 ? "hover:opacity-80" : "opacity-30",
            )}
            src={structure.image}
            alt={structure.name}
            width={200}
            height={200}
            loading={props.eager ? "eager" : "lazy"}
            id={`tutorial${structure.route.replace("/", "-")}`}
          />
        </Link>
        {TextBlock}
      </div>
    </div>
  );
};

export default Building;

const RestoreStructureButton = ({
  structureId,
  structureName,
}: {
  structureId: string;
  structureName: string;
}) => {
  const utils = api.useUtils();

  const { mutate: restorePoints, isPending } =
    api.village.restoreStructurePoints.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.get.invalidate();
        }
      },
    });

  return (
    <Confirm
      title="Restore Structure Points"
      proceed_label="Restore"
      onAccept={() => restorePoints({ structureId })}
      button={
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={`Restore ${structureName} points`}
        >
          <RefreshCw
            className={cn("size-4", isPending && "animate-spin")}
            aria-hidden="true"
          />
        </Button>
      }
    >
      <p>Are you sure you want to restore this structure to full health?</p>
      <p>This will set the structure points to maximum.</p>
    </Confirm>
  );
};

type StructureBonusKey =
  | "anbuSquadsPerLvl"
  | "arenaRewardPerLvl"
  | "bankInterestPerLvl"
  | "blackDiscountPerLvl"
  | "clansPerLvl"
  | "hospitalSpeedupPerLvl"
  | "itemDiscountPerLvl"
  | "missionRewardPerLvl"
  | "patrolsPerLvl"
  | "ramenDiscountPerLvl"
  | "regenIncreasePerLvl"
  | "sleepRegenPerLvl"
  | "structureDiscountPerLvl"
  | "trainBoostPerLvl"
  | "villageDefencePerLvl";

interface StructureBonus {
  key: StructureBonusKey;
  label: string;
  unit: string;
  scale?: number;
  /**
   * Total displayed value at the given level. Defaults to perLvl * level * scale.
   * Override for non-linear bonuses such as bank interest.
   */
  valueAt?: (perLvl: number, level: number) => number;
  /** Formats a single number for display. Defaults to whole numbers. */
  format?: (n: number) => string;
}

const STRUCTURE_BONUSES: StructureBonus[] = [
  { key: "anbuSquadsPerLvl", label: "Anbu Squads", unit: "" },
  { key: "arenaRewardPerLvl", label: "Arena Rewards", unit: "%" },
  {
    key: "bankInterestPerLvl",
    label: "Bank Interest",
    unit: "%",
    valueAt: (perLvl, level) => calcBankInterest(perLvl * level),
    format: (n) => (Number.isInteger(n) ? `${n}` : n.toFixed(1).replace(/\.0$/, "")),
  },
  { key: "blackDiscountPerLvl", label: "Market Discount", unit: "%" },
  {
    key: "clansPerLvl",
    label: "Clan Slots",
    unit: "",
    scale: CLANS_PER_STRUCTURE_LEVEL,
  },
  { key: "hospitalSpeedupPerLvl", label: "Hospital Speed", unit: "%" },
  { key: "itemDiscountPerLvl", label: "Item Discount", unit: "%" },
  { key: "missionRewardPerLvl", label: "Mission/Errand Rewards", unit: "%" },
  { key: "patrolsPerLvl", label: "Patrol Attacking Enemies", unit: "%" },
  { key: "ramenDiscountPerLvl", label: "Ramen Discount", unit: "%" },
  { key: "regenIncreasePerLvl", label: "Regen In Village", unit: "%" },
  { key: "sleepRegenPerLvl", label: "Sleep Regen", unit: "%" },
  { key: "structureDiscountPerLvl", label: "Structure Discount", unit: "%" },
  { key: "trainBoostPerLvl", label: "Training Boost", unit: "%" },
  { key: "villageDefencePerLvl", label: "Village Defence", unit: "%" },
];

const formatNumber = (bonus: StructureBonus, n: number) =>
  (bonus.format ?? ((v: number) => `${v}`))(n);

const computeBonusValue = (bonus: StructureBonus, perLvl: number, level: number) =>
  bonus.valueAt ? bonus.valueAt(perLvl, level) : perLvl * level * (bonus.scale ?? 1);

const UpgradeButton = ({
  structure,
  village,
  clanId,
}: {
  structure: VillageStructure;
  village: Village;
  clanId: string | null;
}) => {
  const utils = api.useUtils();

  const { data } = api.village.get.useQuery({ id: structure.villageId }, {});

  const { mutate: purchase, isPending: isPurchasing } =
    api.kage.upgradeStructure.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await utils.village.get.invalidate();
        }
      },
    });

  const currentFunds = data?.villageData.tokens ?? 0;
  const { cost, tax, discount, total } = calcStructureUpgrade(structure, {
    ...village,
    structures: data?.villageData.structures || [],
  });
  const canAfford =
    total <= currentFunds && (data?.villageData.structureMaintenanceDue ?? 0) === 0;
  const canLevel = structure.level < structure.maxLevel && structure.level !== 0;

  return (
    <div className="inline-flex shrink-0 items-center">
      {(data?.villageData.structureMaintenanceDue ?? 0) > 0 && canLevel && (
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/townhall#Village%20Mission"
                aria-label={`Pay maintenance to upgrade ${structure.name}`}
                className="inline-flex size-7 items-center justify-center rounded-md text-destructive hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
              >
                <LockKeyhole className="size-4" aria-hidden="true" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>
              Pay maintenance in the Town Hall to upgrade.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {canAfford && canLevel && (
        <Confirm
          title="Upgrade Structure"
          proceed_label="Upgrade"
          disabled={isPurchasing}
          onAccept={() =>
            purchase({
              structureId: structure.id,
              villageId: structure.villageId,
              clanId: clanId,
            })
          }
          button={
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={`Upgrade ${structure.name}`}
              disabled={isPurchasing}
            >
              <CircleArrowUp
                className={cn("size-4", isPurchasing && "animate-spin")}
                aria-hidden="true"
              />
            </Button>
          }
        >
          <p>
            Upgrading this structure will cost a total of {total} village tokens (base
            cost of {cost} + {tax} population tax - {discount} discounted from town hall
            level).
          </p>
          <p>You currently have {currentFunds} village tokens.</p>
          {(() => {
            const bonuses = STRUCTURE_BONUSES.filter(
              (b) => ((structure[b.key] as number) ?? 0) > 0,
            );
            if (bonuses.length === 0) return null;
            return (
              <div className="mt-2">
                <p className="font-semibold text-sm">Next level provides:</p>
                <ul className="mt-1 list-inside list-disc text-sm">
                  {bonuses.map((b) => {
                    const perLvl = structure[b.key] as number;
                    const delta =
                      computeBonusValue(b, perLvl, structure.level + 1) -
                      computeBonusValue(b, perLvl, structure.level);
                    return (
                      <li key={b.key}>
                        +{formatNumber(b, delta)}
                        {b.unit} {b.label}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })()}
        </Confirm>
      )}
    </div>
  );
};

/**
 * Generates an array of reward messages based on the level of a village structure.
 * @param structure - The village structure object.
 * @returns An array of reward messages.
 */
export const StructureRewardEntries = (structure: VillageStructure) => {
  const baseLevel = structure.level;
  const effectiveLevel = getEffectiveStructureLevel(structure);

  const msgs: string[] = [];
  if (effectiveLevel > 0) {
    for (const bonus of STRUCTURE_BONUSES) {
      const perLvl = (structure[bonus.key] as number) ?? 0;
      if (perLvl <= 0) continue;
      const baseValue = computeBonusValue(bonus, perLvl, baseLevel);
      const effectiveValue =
        computeBonusValue(bonus, perLvl, effectiveLevel) *
        getRaidStructureMultiplier(structure);
      const bonusValue = effectiveValue - baseValue;
      const suffix = bonus.unit;
      let valueText = `${formatNumber(bonus, baseValue)}${suffix}`;
      if (bonusValue > 0) {
        valueText += ` (+${formatNumber(bonus, Math.abs(bonusValue))}${suffix})`;
      } else if (bonusValue < 0) {
        valueText += ` (−${formatNumber(bonus, Math.abs(bonusValue))}${suffix})`;
      }
      msgs.push(`${bonus.label}: +${valueText}`);
    }
  }
  if (msgs.length === 0) msgs.push("No rewards for this structure");
  return msgs.map((e) => <p key={`building-reward-${e}`}>{e}</p>);
};
