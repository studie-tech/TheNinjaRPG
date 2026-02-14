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

  // Helper to format value with bonus
  const formatValue = (perLvl: number, suffix: string = "") => {
    const baseValue = perLvl * baseLevel;
    const bonusValue = perLvl * bonusLevel;
    if (bonusLevel > 0) {
      return `${baseValue}${suffix} (+${bonusValue}${suffix})`;
    } else if (bonusLevel < 0) {
      return `${baseValue}${suffix} (−${Math.abs(bonusValue)}${suffix})`;
    }
    return `${baseValue}${suffix}`;
  };

  const msgs: React.ReactNode[] = [];
  if (effectiveLevel > 0) {
    if (structure.anbuSquadsPerLvl > 0) {
      msgs.push(`Anbu Squads: +${formatValue(structure.anbuSquadsPerLvl)}`);
    }
    if (structure.arenaRewardPerLvl > 0) {
      msgs.push(`Arena Rewards: +${formatValue(structure.arenaRewardPerLvl, "%")}`);
    }
    if (structure.bankInterestPerLvl > 0) {
      const baseInterest = calcBankInterest(structure.bankInterestPerLvl * baseLevel);
      const effectiveInterest = calcBankInterest(
        structure.bankInterestPerLvl * effectiveLevel,
      );
      const bonusInterest = effectiveInterest - baseInterest;
      if (bonusInterest > 0) {
        msgs.push(`Bank Interest: +${baseInterest}% (+${bonusInterest.toFixed(1)}%)`);
      } else if (bonusInterest < 0) {
        msgs.push(
          `Bank Interest: +${baseInterest}% (−${Math.abs(bonusInterest).toFixed(1)}%)`,
        );
      } else {
        msgs.push(`Bank Interest: +${baseInterest}%`);
      }
    }
    if (structure.blackDiscountPerLvl > 0) {
      msgs.push(`Market discount: ${formatValue(structure.blackDiscountPerLvl, "%")}`);
    }
    if (structure.clansPerLvl > 0) {
      const clansPerLvl = structure.clansPerLvl * CLANS_PER_STRUCTURE_LEVEL;
      msgs.push(`Clans: +${formatValue(clansPerLvl)}`);
    }
    if (structure.hospitalSpeedupPerLvl > 0) {
      msgs.push(
        `Hospital Speed: +${formatValue(structure.hospitalSpeedupPerLvl, "%")}`,
      );
    }
    if (structure.itemDiscountPerLvl > 0) {
      msgs.push(`Item discount: ${formatValue(structure.itemDiscountPerLvl, "%")}`);
    }
    if (structure.patrolsPerLvl > 0) {
      msgs.push(
        `Patrol attacking enemies: +${formatValue(structure.patrolsPerLvl, "%")}`,
      );
    }
    if (structure.ramenDiscountPerLvl > 0) {
      msgs.push(`Ramen discount: ${formatValue(structure.ramenDiscountPerLvl, "%")}`);
    }
    if (structure.regenIncreasePerLvl > 0) {
      msgs.push(
        `Regen in Village: +${formatValue(structure.regenIncreasePerLvl, "%")}`,
      );
    }
    if (structure.sleepRegenPerLvl > 0) {
      msgs.push(`Sleep Regen: +${formatValue(structure.sleepRegenPerLvl, "%")}`);
    }
    if (structure.structureDiscountPerLvl > 0) {
      msgs.push(
        `Structure Discount: ${formatValue(structure.structureDiscountPerLvl, "%")}`,
      );
    }
    if (structure.trainBoostPerLvl > 0) {
      msgs.push(`Training Boost: +${formatValue(structure.trainBoostPerLvl, "%")}`);
    }
    if (structure.villageDefencePerLvl > 0) {
      msgs.push(
        `Village Defence: +${formatValue(structure.villageDefencePerLvl, "%")}`,
      );
    }
  }
  if (msgs.length === 0) msgs.push("No rewards for this structure");
  return msgs.map((e) => <p key={`building-reward-${e}`}>{e}</p>);
};
