"use client";

import { CircleArrowUp, Info, RefreshCw } from "lucide-react";
import Link from "next/link";
import { api } from "@/app/_trpc/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CLANS_PER_STRUCTURE_LEVEL } from "@/drizzle/constants";
import type { Village, VillageStructure } from "@/drizzle/schema";
import Confirm2 from "@/layout/Confirm2";
import Image from "@/layout/Image";
import StatusBar from "@/layout/StatusBar";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { canAdministrateWars } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  calcBankInterest,
  calcStructureUpgrade,
  getEffectiveStructureLevel,
} from "@/utils/village";

interface BuildingProps {
  structure: VillageStructure;
  village: Village;
  showBar?: boolean;
  textPosition: "bottom" | "right";
  showUpgrade?: boolean;
  showNumbers?: boolean;
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
    <div className="text-xs">
      <p className="font-bold">{structure.name}</p>
      <div className="flex flex-row items-center justify-center gap-1">
        <p>
          Lvl. {structure.level}
          {delta > 0 && <span className="text-green-500"> (+{delta})</span>}
          {delta < 0 && <span className="text-red-500"> (−{Math.abs(delta)})</span>}
        </p>{" "}
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger>
              <Info className="h-4 w-4" />
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
          <RestoreStructureButton structureId={structure.id} />
        )}
      </div>
    </div>
  );
  // Render
  return (
    <div className={`relative flex flex-col items-center justify-center text-center`}>
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
        className={`grid ${textPosition === "right" ? "grid-cols-2" : ""} items-center`}
      >
        <Link href={structure.route}>
          <Image
            className={`${structure.level > 0 ? "hover:opacity-80" : "opacity-30"}`}
            src={structure.image}
            alt={structure.name}
            width={200}
            height={200}
            priority={true}
            id={`tutorial${structure.route.replace("/", "-")}`}
          />
        </Link>
        {TextBlock}
      </div>
    </div>
  );
};

export default Building;

const RestoreStructureButton = ({ structureId }: { structureId: string }) => {
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
    <Confirm2
      title="Restore Structure Points"
      proceed_label="Restore"
      onAccept={() => restorePoints({ structureId })}
      button={
        <RefreshCw
          className={cn(
            "h-4 w-4 hover:cursor-pointer hover:text-orange-500",
            isPending && "animate-spin",
          )}
        />
      }
    >
      <p>Are you sure you want to restore this structure to full health?</p>
      <p>This will set the structure points to maximum.</p>
    </Confirm2>
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
  const canAfford = total <= currentFunds;
  const canLevel = structure.level < structure.maxLevel && structure.level !== 0;

  return (
    <div>
      {canAfford && canLevel && (
        <Confirm2
          title="Upgrade Structure"
          proceed_label="Upgrade"
          onAccept={() =>
            purchase({
              structureId: structure.id,
              villageId: structure.villageId,
              clanId: clanId,
            })
          }
          button={
            <CircleArrowUp
              className={cn(
                "h-4 w-4 hover:cursor-pointer hover:text-orange-500",
                isPurchasing && "animate-spin",
              )}
            />
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
                <p className="text-sm font-semibold">Next level provides:</p>
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
        </Confirm2>
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
  const bonusLevel = effectiveLevel - baseLevel;

  const msgs: string[] = [];
  if (effectiveLevel > 0) {
    for (const bonus of STRUCTURE_BONUSES) {
      const perLvl = (structure[bonus.key] as number) ?? 0;
      if (perLvl <= 0) continue;
      const baseValue = computeBonusValue(bonus, perLvl, baseLevel);
      const effectiveValue = computeBonusValue(bonus, perLvl, effectiveLevel);
      const bonusValue = effectiveValue - baseValue;
      const suffix = bonus.unit;
      let valueText = `${formatNumber(bonus, baseValue)}${suffix}`;
      if (bonusLevel > 0 && bonusValue !== 0) {
        valueText += ` (+${formatNumber(bonus, Math.abs(bonusValue))}${suffix})`;
      } else if (bonusLevel < 0 && bonusValue !== 0) {
        valueText += ` (−${formatNumber(bonus, Math.abs(bonusValue))}${suffix})`;
      }
      msgs.push(`${bonus.label}: +${valueText}`);
    }
  }
  if (msgs.length === 0) msgs.push("No rewards for this structure");
  return msgs.map((e) => <p key={`building-reward-${e}`}>{e}</p>);
};
