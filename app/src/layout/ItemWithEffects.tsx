import { BarChartBig, Box, Copy, SquarePen, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type React from "react";
import { api } from "@/app/_trpc/client";
import type {
  Bloodline,
  GameAsset,
  Item,
  ItemRarity,
  Jutsu,
  Quest,
} from "@/drizzle/schema";
import Confirm2 from "@/layout/Confirm2";
import ContentImage from "@/layout/ContentImage";
import DurabilityBar from "@/layout/DurabilityBar";
import ElementImage from "@/layout/ElementImage";
import Model3d from "@/layout/Model3d";
import { getPreventTypeName } from "@/libs/combat/util";
import { getRewardArray } from "@/libs/objectives";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { canChangeContent } from "@/utils/permissions";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { formatBattleUsageType } from "@/utils/string";
import { useUserData } from "@/utils/UserContext";
import type { ZodAllTags } from "@/validators/combat";
import { getTagSchema } from "@/validators/combat";

export type GenericObject = {
  id: string;
  name: string;
  description: string;
  image?: string;
  rarity?: ItemRarity;
  level?: number;
  sector?: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  attacks?: string[];
  effects?: ZodAllTags[];
  village?: { name: string };
  href?: string;
};

export interface ItemWithEffectsProps {
  item:
    | Bloodline
    | (Item & { imbuements?: Item[]; curDurability?: number })
    | Jutsu
    | Quest
    | GameAsset
    | GenericObject;
  hideDetails?: boolean;
  showEvolutions?: boolean;
  imageBorder?: boolean;
  imageExtra?: React.ReactNode;
  showEdit?:
    | "bloodline"
    | "bloodline/reskins"
    | "item"
    | "jutsu"
    | "jutsu/reskins"
    | "ai"
    | "quest"
    | "badge"
    | "asset"
    | "skillTree";
  showStatistic?: "bloodline" | "item" | "jutsu" | "ai";
  showCopy?: "quest" | "ai" | "item";
  show3d?: boolean;
  hideTitle?: boolean;
  hideImage?: boolean;
  hideEffects?: boolean;
  hideDates?: boolean;
  hideData?: boolean;
  onDelete?: (id: string) => void;
  folderName?: string;
}

const ItemWithEffects: React.FC<ItemWithEffectsProps> = (props) => {
  const {
    item,
    showEdit,
    showStatistic,
    showCopy,
    show3d,
    hideTitle,
    hideDetails,
    showEvolutions,
    hideImage,
    hideEffects,
    hideDates,
    hideData,
    onDelete,
    folderName,
  } = props;
  const { data: userData } = useUserData();
  const router = useRouter();

  // Get bloodline names for displaying bloodline requirements
  const { data: bloodlinesData } = api.bloodline.getAllNames.useQuery();

  // Only fetch evolutions when the caller explicitly opts in, to avoid N+1 queries
  // in list views. Pass showEvolutions={true} for single-item detail views (e.g.
  // the jutsus/traininggrounds modals) where the evolution chain is meaningful.
  const isJutsuItem = "jutsuType" in item;
  const { data: evolutionsData } = api.jutsu.getEvolutions.useQuery(
    { jutsuId: item.id },
    { enabled: isJutsuItem && !hideData && !!showEvolutions, staleTime: 5 * 60 * 1000 },
  );

  // Setup clone mutations
  const { mutate: cloneQuest } = api.quests.clone.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        router.push(`/manual/quest/edit/${data.message}`);
      }
    },
  });

  const { mutate: cloneAi } = api.profile.cloneAi.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        router.push(`/manual/ai/edit/${data.message}`);
      }
    },
  });

  const { mutate: cloneItem } = api.item.clone.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        router.push(`/manual/item/edit/${data.message}`);
      }
    },
  });

  // Extract effects if they exist
  const effects = [
    ...("effects" in props.item
      ? (props.item.effects as Omit<ZodAllTags, "description">[])
      : []
    ).map((effect) => ({ ...effect, color: "bg-poppopover" })),
    ...("imbuements" in props.item && props.item.imbuements
      ? props.item.imbuements.flatMap(
          (imbuement) =>
            imbuement.effects?.map((effect) => ({
              ...effect,
              color: "bg-purple-400",
            })) ?? [],
        )
      : []),
  ].filter(Boolean);

  // Define image
  let image =
    "image" in item ? (
      <div className="relative flex flex-col items-center justify-center">
        <div className="relative">
          <ContentImage
            image={item.image}
            frames={"frames" in item ? item.frames : undefined}
            speed={"speed" in item ? item.speed : undefined}
            rarity={"rarity" in item ? item.rarity : undefined}
            alt={item.name}
            className=""
          />
          {/* Durability bar */}
          {"maxDurability" in item &&
            "curDurability" in item &&
            item.maxDurability !== undefined &&
            item.curDurability !== undefined && (
              <DurabilityBar
                currentDurability={item.curDurability}
                maxDurability={item.maxDurability}
                position="top-right"
                size="large"
              />
            )}
        </div>
        {props.imageExtra}
      </div>
    ) : null;
  if ("href" in item && item.href) {
    image = <Link href={item.href}>{image}</Link>;
  }

  // Define rewards from quests if they are there
  const rewards = "content" in item ? getRewardArray(item.content.reward) : [];
  return (
    <div className="mb-3 flex flex-row items-center rounded-lg border bg-popover p-2 align-middle shadow-sm">
      {!hideImage && <div className="mx-3 hidden basis-1/3 md:block">{image}</div>}

      <div className={cn("basis-full text-sm", hideImage || "md:basis-2/3")}>
        <div className="flex flex-row">
          {!hideImage && (
            <div className="relative block md:hidden md:basis-1/3">{image}</div>
          )}

          <div className="relative flex basis-full flex-col pl-5 md:pl-0">
            {!hideTitle ? (
              <h3 className="font-bold text-popover-foreground text-xl tracking-tight">
                {item.name}
              </h3>
            ) : (
              <br />
            )}
            {!hideDetails && !hideDates && (
              <div className="flex flex-row gap-2">
                {item.createdAt && (
                  <div>
                    <b>Created: </b>
                    {item.createdAt instanceof Date
                      ? item.createdAt.toLocaleDateString()
                      : item.createdAt}
                  </div>
                )}
                {item.updatedAt && (
                  <div>
                    <b>Updated: </b>
                    {item.updatedAt instanceof Date
                      ? item.updatedAt.toLocaleDateString()
                      : item.updatedAt}
                  </div>
                )}
                {"createdBy" in item && item.createdBy && (
                  <div>
                    <b>Created By: </b>
                    {item.createdBy}
                  </div>
                )}
                {"expireFromStoreAt" in item && item.expireFromStoreAt && (
                  <div>
                    <b>Expires: </b>
                    {item.expireFromStoreAt}
                  </div>
                )}
              </div>
            )}
            <div className="absolute right-1 flex flex-row">
              {showStatistic && (
                <Link
                  href={`/manual/${showStatistic}/statistics/${item.id}`}
                  className="mr-1"
                >
                  <BarChartBig className="h-6 w-6 hover:text-popover-foreground/50" />
                </Link>
              )}
              {showEdit && userData && canChangeContent(userData.role) && (
                <>
                  {showCopy === "quest" && (
                    <Confirm2
                      title="Clone Quest"
                      button={
                        <Copy className="h-6 w-6 hover:text-popover-foreground/50" />
                      }
                      onAccept={(e) => {
                        e.preventDefault();
                        cloneQuest({ id: item.id });
                      }}
                    >
                      This will create a copy of this quest. You will be redirected to
                      edit the new quest.
                    </Confirm2>
                  )}
                  {showCopy === "ai" && (
                    <Confirm2
                      title="Clone AI"
                      button={
                        <Copy className="h-6 w-6 hover:text-popover-foreground/50" />
                      }
                      onAccept={(e) => {
                        e.preventDefault();
                        cloneAi({ id: item.id });
                      }}
                    >
                      This will create a copy of this AI. You will be redirected to edit
                      the new AI.
                    </Confirm2>
                  )}
                  {showCopy === "item" && (
                    <Confirm2
                      title="Clone Item"
                      button={
                        <Copy className="h-6 w-6 hover:text-popover-foreground/50" />
                      }
                      onAccept={(e) => {
                        e.preventDefault();
                        cloneItem({ id: item.id });
                      }}
                    >
                      This will create a copy of this item. You will be redirected to
                      edit the new item.
                    </Confirm2>
                  )}
                  {show3d && "avatar" in item && "avatar3d" in item && item.avatar3d ? (
                    <Confirm2
                      title="3d Model"
                      button={
                        <Box className="h-6 w-6 hover:cursor-pointer hover:text-popover-foreground/50" />
                      }
                    >
                      <Model3d
                        modelUrl={item.avatar3d as string}
                        imageUrl={item.avatar as string}
                        alt={item.name}
                        size={100}
                      />
                    </Confirm2>
                  ) : undefined}
                  <Link href={`/manual/${showEdit}/edit/${item.id}`}>
                    <SquarePen className="h-6 w-6 hover:text-popover-foreground/50" />
                  </Link>
                  {onDelete && canChangeContent(userData.role) && (
                    <Confirm2
                      title="Confirm Deletion"
                      button={
                        <Trash2 className="h-6 w-6 hover:cursor-pointer hover:text-popover-foreground/50" />
                      }
                      onAccept={(e) => {
                        e.preventDefault();
                        if (onDelete) onDelete(item.id);
                      }}
                    >
                      You are about to delete this. Are you sure? This will affect ALL
                      USERS WHO HAS THE CONTENT IN QUESTION.
                    </Confirm2>
                  )}
                </>
              )}
            </div>

            <hr className="py-1" />
            {!hideDetails && "description" in item && item.description && (
              <div>{parseHtml(item.description)}</div>
            )}
            {!hideDetails &&
              "itemType" in item &&
              item.itemType === "CRYSTAL" &&
              "crystalTargetTypes" in item &&
              item.crystalTargetTypes && (
                <div className="mt-2">
                  <b>Can Imbue: </b>
                  <span className="font-medium text-blue-600">
                    {item.crystalTargetTypes}
                  </span>
                </div>
              )}
          </div>
        </div>
        <div>
          {!hideData && (
            <div className="my-2 grid grid-cols-2 rounded-lg bg-poppopover p-2 text-xs md:text-base">
              {"bloodline" in item && item.bloodline !== null && (
                <p className="col-span-2">
                  <b>Bloodline</b>: {(item?.bloodline as Bloodline)?.name}
                </p>
              )}
              {"attacks" in item && item.attacks && (
                <p className="col-span-2">
                  <b>Attacks</b>: {item.attacks.join(", ")}
                </p>
              )}
              {"sector" in item && item.sector !== undefined && item.sector > 0 && (
                <p className="col-span-2">
                  <b>Sector</b>: {item.sector}
                </p>
              )}
              {"jutsuType" in item && (
                <p>
                  <b>Jutsu Type</b>: {capitalizeFirstLetter(item?.jutsuType)}
                </p>
              )}
              {"jutsuWeapon" in item && item.jutsuWeapon !== "NONE" && (
                <p>
                  <b>Jutsu Weapon</b>: {capitalizeFirstLetter(item?.jutsuWeapon)}
                </p>
              )}
              {"battleUsageType" in item && item.battleUsageType && (
                <p className="col-span-2">
                  <b>Battle Type</b>: {formatBattleUsageType(item.battleUsageType)}
                </p>
              )}
              {"rarity" in item && item.rarity && (
                <p>
                  <b>Rarity</b>: {capitalizeFirstLetter(item.rarity)}
                </p>
              )}
              {"maxImbueNumber" in item && item.maxImbueNumber > 0 && (
                <p>
                  <b>Max Imbue Number</b>: {item.maxImbueNumber}
                </p>
              )}
              {"canBeImbued" in item && item.canBeImbued && (
                <p>
                  <b>Can be Imbued</b>: {item.canBeImbued ? "yes" : "no"}
                </p>
              )}
              {"canBeHunted" in item && item.canBeHunted && (
                <p>
                  <b>Can be Hunted</b>: {item.canBeHunted ? "yes" : "no"}
                </p>
              )}
              {"canBeGathered" in item && item.canBeGathered && (
                <p>
                  <b>Can be Gathered</b>: {item.canBeGathered ? "yes" : "no"}
                </p>
              )}
              {"canBeTraded" in item && item.canBeTraded && (
                <p>
                  <b>Can be Traded</b>: {item.canBeTraded ? "yes" : "no"}
                </p>
              )}
              {"canBeCrafted" in item && item.canBeCrafted && (
                <p>
                  <b>Can be Crafted</b>: {item.canBeCrafted ? "yes" : "no"}
                </p>
              )}
              {"statClassification" in item && item.statClassification && (
                <p>
                  <b>Class</b>: {capitalizeFirstLetter(item.statClassification)}
                </p>
              )}
              {"difficulty" in item && item.difficulty && (
                <p>
                  <b>Difficulty</b>: {item.difficulty}
                </p>
              )}

              {"level" in item && item.level !== undefined && item.level > 0 && (
                <p>
                  <b>Level</b>: {item.level}
                </p>
              )}
              {"regenIncrease" in item && item.regenIncrease > 0 && (
                <p>
                  <b>Regen</b>: +{item.regenIncrease}
                </p>
              )}
              {"rank" in item && item.rank && (
                <p>
                  <b>Rank</b>: {item.rank}
                </p>
              )}
              {"frames" in item && item.frames && (
                <p>
                  <b>Frames</b>: {item.frames}
                </p>
              )}
              {"speed" in item && item.speed && (
                <p>
                  <b>Speed</b>: {item.speed}
                </p>
              )}
              {"type" in item && item.type && (
                <p>
                  <b>Type</b>: {item.type.toLowerCase()}
                </p>
              )}
              {"onInitialBattleField" in item && item.onInitialBattleField && (
                <p>
                  <b>On battlefield</b>: {item.onInitialBattleField ? "yes" : "no"}
                </p>
              )}
              {"licenseDetails" in item && item.licenseDetails && (
                <p className="col-span-2">
                  <b>License</b>: {item.licenseDetails}
                </p>
              )}
              {"village" in item &&
                item.village &&
                typeof item.village === "object" &&
                item.village?.name && (
                  <p>
                    <b>Village</b>: {item.village.name}
                  </p>
                )}
              {"inArena" in item &&
                "isSummon" in item &&
                "isEvent" in item &&
                "inShrines" in item && (
                  <p>
                    <b>Classification:</b>
                    {[
                      item.inArena && "Arena",
                      item.isSummon && "Summon",
                      item.isEvent && "Event",
                      item.inShrines && "Shrine",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
              {"stackSize" in item && item.stackSize > 0 && (
                <p>
                  <b>Stackable</b>: {item.stackSize}
                </p>
              )}
              {"itemType" in item && (
                <p>
                  <b>Item type</b>: {item.itemType.toLowerCase()}
                </p>
              )}
              {"hidden" in item && (
                <p>
                  <b>Hidden</b>: {item.hidden ? "yes" : "no"}
                </p>
              )}
              {folderName && (
                <p>
                  <b>Folder</b>: {folderName}
                </p>
              )}
              {"isEventItem" in item && item.isEventItem && (
                <p>
                  <b>Event Item</b>: yes
                </p>
              )}
              {"cooldown" in item && item.cooldown > 0 && (
                <p>
                  <b>Cooldown</b>: {item.cooldown}
                </p>
              )}
              {"range" in item && item.target !== "CHARACTER" && (
                <p>
                  <b>Range</b>: {item.range}
                </p>
              )}
              {"destroyOnUse" in item && (
                <p>
                  <b>Destroy on use</b>: {item.destroyOnUse ? "yes" : "no"}
                </p>
              )}
              {"chakraCost" in item && item.chakraCost > 0 && (
                <p>
                  <b>Chakra Usage</b>: {item.chakraCost}
                </p>
              )}
              {"staminaCost" in item && item.staminaCost > 0 && (
                <p>
                  <b>Stamina Usage</b>: {item.staminaCost}
                </p>
              )}
              {"healthCost" in item && item.healthCost > 0 && (
                <p>
                  <b>Health Usage</b>: {item.healthCost}
                </p>
              )}
              {"actionCostPerc" in item && item.actionCostPerc > 0 && (
                <p>
                  <b>Action Usage</b>: {item.actionCostPerc}%
                </p>
              )}
              {"target" in item && (
                <p>
                  <b>Target</b>: {item.target.toLowerCase()}
                </p>
              )}
              {"method" in item && (
                <p>
                  <b>Method</b>: {item.method.toLowerCase()}
                </p>
              )}
              {"weaponType" in item && item.weaponType && (
                <p>
                  <b>Weapon</b>: {item.weaponType.toLowerCase()}
                </p>
              )}
              {"maxDurability" in item && item.maxDurability !== undefined && (
                <p>
                  <b>Durability</b>:{" "}
                  {"curDurability" in item && item.curDurability !== undefined
                    ? item.curDurability
                    : item.maxDurability}{" "}
                  / {item.maxDurability}
                </p>
              )}
              {"slot" in item && item.slot && (
                <p>
                  <b>Equip</b>: {item.slot.toLowerCase()}
                </p>
              )}
              {"requiredRank" in item && item.requiredRank && (
                <p>
                  <b>Required Rank</b>: {item.requiredRank}
                </p>
              )}
              {"questRank" in item && item.questRank && (
                <p>
                  <b>Minimum Rank</b>: {item.questRank}
                </p>
              )}
              {"requiredLevel" in item && item.requiredLevel && (
                <p>
                  <b>Required Level</b>: {item.requiredLevel}
                </p>
              )}
              {"bloodlineId" in item && item.bloodlineId && (
                <p>
                  <b>Required Bloodline</b>:{" "}
                  {bloodlinesData?.find((b) => b.id === item.bloodlineId)?.name ||
                    item.bloodlineId}
                </p>
              )}
              {"parentJutsuId" in item && item.parentJutsuId && (
                <p className="col-span-2">
                  <b>Evolution</b>: Yes (evolves from a parent jutsu)
                </p>
              )}
              {"requiredNinjutsuOffence" in item &&
                item.requiredNinjutsuOffence != null && (
                  <p>
                    <b>Req. Nin. Offence</b>: {item.requiredNinjutsuOffence}
                  </p>
                )}
              {"requiredNinjutsuDefence" in item &&
                item.requiredNinjutsuDefence != null && (
                  <p>
                    <b>Req. Nin. Defence</b>: {item.requiredNinjutsuDefence}
                  </p>
                )}
              {"requiredGenjutsuOffence" in item &&
                item.requiredGenjutsuOffence != null && (
                  <p>
                    <b>Req. Gen. Offence</b>: {item.requiredGenjutsuOffence}
                  </p>
                )}
              {"requiredGenjutsuDefence" in item &&
                item.requiredGenjutsuDefence != null && (
                  <p>
                    <b>Req. Gen. Defence</b>: {item.requiredGenjutsuDefence}
                  </p>
                )}
              {"requiredTaijutsuOffence" in item &&
                item.requiredTaijutsuOffence != null && (
                  <p>
                    <b>Req. Tai. Offence</b>: {item.requiredTaijutsuOffence}
                  </p>
                )}
              {"requiredTaijutsuDefence" in item &&
                item.requiredTaijutsuDefence != null && (
                  <p>
                    <b>Req. Tai. Defence</b>: {item.requiredTaijutsuDefence}
                  </p>
                )}
              {"requiredBukijutsuOffence" in item &&
                item.requiredBukijutsuOffence != null && (
                  <p>
                    <b>Req. Buki. Offence</b>: {item.requiredBukijutsuOffence}
                  </p>
                )}
              {"requiredBukijutsuDefence" in item &&
                item.requiredBukijutsuDefence != null && (
                  <p>
                    <b>Req. Buki. Defence</b>: {item.requiredBukijutsuDefence}
                  </p>
                )}
              {"requiredStrength" in item && item.requiredStrength != null && (
                <p>
                  <b>Req. Strength</b>: {item.requiredStrength}
                </p>
              )}
              {"requiredSpeed" in item && item.requiredSpeed != null && (
                <p>
                  <b>Req. Speed</b>: {item.requiredSpeed}
                </p>
              )}
              {"requiredIntelligence" in item && item.requiredIntelligence != null && (
                <p>
                  <b>Req. Intelligence</b>: {item.requiredIntelligence}
                </p>
              )}
              {"requiredWillpower" in item && item.requiredWillpower != null && (
                <p>
                  <b>Req. Willpower</b>: {item.requiredWillpower}
                </p>
              )}
              {"maxLevel" in item && item.maxLevel && (
                <p>
                  <b>Max Level</b>: {item.maxLevel}
                </p>
              )}
              {"questType" in item && item.questType && (
                <p>
                  <b>Quest Type</b>: {item.questType}
                </p>
              )}
              {"tierLevel" in item &&
                item.tierLevel &&
                "questType" in item &&
                item.questType === "tier" && (
                  <p>
                    <b>Tier Level</b>: {item.tierLevel}
                  </p>
                )}
              {"content" in item && item.content && (
                <div className="col-span-2">
                  <b>Reward:</b> {rewards.join(", ")}
                </div>
              )}
              {"cost" in item && item.cost > 0 && (
                <div className="col-span-2">
                  <b>Shop Price:</b> {item.cost} ryo
                </div>
              )}
              {"repsCost" in item && item.repsCost > 0 && (
                <div className="col-span-2">
                  <b>Shop Price:</b> {item.repsCost} reputation points
                </div>
              )}
              {"chakraCostReducePerLvl" in item && item.chakraCostReducePerLvl > 0 && (
                <p className="col-span-2">
                  <b>Chakra Usage Reduction Per Lvl</b>: {item.chakraCostReducePerLvl}
                </p>
              )}
              {"staminaCostReducePerLvl" in item &&
                item.staminaCostReducePerLvl > 0 && (
                  <p className="col-span-2">
                    <b>Stamina Usage Reduction Per Lvl</b>:{" "}
                    {item.staminaCostReducePerLvl}
                  </p>
                )}
              {"healthCostReducePerLvl" in item && item.healthCostReducePerLvl > 0 && (
                <p className="col-span-2">
                  <b>Health Usage Reduction Per Lvl</b>: {item.healthCostReducePerLvl}
                </p>
              )}
              {"traits" in item && item.traits && (
                <p className="col-span-2">
                  <b>Traits</b>: {item.traits}
                </p>
              )}
              {evolutionsData && evolutionsData.length > 0 && (
                <div className="col-span-2">
                  <b>Evolutions</b>: {evolutionsData.map((evo) => evo.name).join(", ")}
                </div>
              )}
            </div>
          )}
          {/* Show quest timing specific details for story and event quests */}
          {"questType" in item && ["story", "event"].includes(item.questType) && (
            <div className="my-2 grid grid-cols-2 rounded-lg bg-poppopover p-2">
              {"maxAttempts" in item && item.maxAttempts > 0 && (
                <p>
                  <b>Max Attempts</b>: {item.maxAttempts}
                </p>
              )}
              {"maxCompletes" in item && item.maxCompletes > 0 && (
                <p>
                  <b>Max Completes</b>: {item.maxCompletes}
                </p>
              )}
              {"previousAttempts" in item && (item.previousAttempts as number) > 0 && (
                <p>
                  <b>Previous Attempts</b>: {item.previousAttempts as number}
                </p>
              )}
              {"previousCompletes" in item &&
                (item.previousCompletes as number) > 0 && (
                  <p>
                    <b>Previous Completes</b>: {item.previousCompletes as number}
                  </p>
                )}
              {"retryDelay" in item && item.retryDelay !== "none" && (
                <p>
                  <b>Retry Delay</b>: {item.retryDelay}
                </p>
              )}
              <div className="col-span-2 grid grid-cols-2">
                {"startsAt" in item && item.startsAt && (
                  <p>
                    <b>Starts At</b>: {item.startsAt}
                  </p>
                )}
                {"endsAt" in item && item.endsAt && (
                  <p>
                    <b>Ends At</b>: {item.endsAt}
                  </p>
                )}
              </div>
            </div>
          )}
          {/* Show medical rank requirement for quests */}
          {"medicalRank" in item && item.medicalRank && item.medicalRank !== "NONE" && (
            <div className="my-2 rounded-lg bg-poppopover p-2">
              <p>
                <b>Medical Rank Requirement</b>: {item.medicalRank}
              </p>
            </div>
          )}
          {"huntingRank" in item && item.huntingRank && item.huntingRank !== "NONE" && (
            <div className="my-2 rounded-lg bg-poppopover p-2">
              <p>
                <b>Hunting Rank Requirement</b>: {item.huntingRank}
              </p>
            </div>
          )}
          {"gatheringRank" in item &&
            item.gatheringRank &&
            item.gatheringRank !== "NONE" && (
              <div className="my-2 rounded-lg bg-poppopover p-2">
                <p>
                  <b>Gathering Rank Requirement</b>: {item.gatheringRank}
                </p>
              </div>
            )}
          {/* {objectives.length > 0 && (
            <div className={`my-2 rounded-lg bg-poppopover p-2`}>
              <p className="font-bold">Objectives</p>
              <div className="grid grid-cols-5 md:grid-cols-3 lg:md:grid-cols-5 gap-3 p-2">
                {objectives
                  .filter((o) => o.task !== "dialog")
                  .map((objective, i) => {
                    const { image, title } = getObjectiveImage(objective);
                    return (
                      <div
                        key={objective.task + i.toString()}
                        className={`flex flex-col items-center`}
                      >
                        <Image
                          className="basis-1/4"
                          alt={objective.task}
                          src={image}
                          width={60}
                          height={60}
                        />
                        {title}
                      </div>
                    );
                  })}
              </div>
            </div>
          )} */}

          {!hideEffects &&
            effects?.map((effect, i) => {
              // Get schema for parsing effect
              const schema = getTagSchema(effect.type);
              // Delete description, so that we get the default one
              if ("description" in effect) delete effect.description;
              const result = schema.safeParse(effect);
              const parsedEffect = result.success ? result.data : undefined;

              // Get custom description for immunity effects
              const getEffectDescription = () => {
                if (
                  parsedEffect?.type === "immunity" &&
                  "blocks" in parsedEffect &&
                  parsedEffect.blocks
                ) {
                  const preventType = getPreventTypeName(parsedEffect.blocks as string);
                  return `Grants immunity to ${preventType} prevention effects`;
                }
                return parsedEffect?.description;
              };

              return (
                <div
                  key={effect.type + i.toString()}
                  className={`my-2 rounded-lg ${parsedEffect ? effect.color : "bg-red-100"} p-2`}
                >
                  {!parsedEffect && (
                    <div className="pb-1">
                      <b>Effect {i + 1}: </b> <i>{effect.type}</i> -{" "}
                      {JSON.stringify(result)} - PLEASE REPORT!
                    </div>
                  )}
                  {parsedEffect && (
                    <>
                      <div className="pb-1">
                        <b>Effect {i + 1}: </b> <i>{getEffectDescription()}</i>
                      </div>
                      <div className="grid grid-cols-2">
                        {"rounds" in parsedEffect &&
                          parsedEffect.rounds !== undefined && (
                            <span>
                              <b>Rounds: </b> {parsedEffect.rounds}
                            </span>
                          )}
                        {"calculation" in parsedEffect && (
                          <span>
                            <b>Calculation: </b>
                            {parsedEffect.calculation}
                          </span>
                        )}
                        {"blocks" in parsedEffect && parsedEffect.blocks && (
                          <span>
                            <b>Blocks: </b>
                            {`${getPreventTypeName(parsedEffect.blocks as string)} prevention`}
                          </span>
                        )}
                        {"power" in parsedEffect && (
                          <span>
                            <b>Effect Power: </b>
                            {parsedEffect.power}
                          </span>
                        )}
                        {"rank" in parsedEffect && (
                          <span>
                            <b>Rank: </b>
                            {capitalizeFirstLetter(parsedEffect.rank)}
                          </span>
                        )}
                        {"aiHp" in parsedEffect && (
                          <span>
                            <b>Health Points: </b>
                            {parsedEffect.aiHp}
                          </span>
                        )}
                        {"target" in parsedEffect &&
                          parsedEffect.target &&
                          (!("target" in item) ||
                            parsedEffect.target !== item?.target) && (
                            <span>
                              <b>Target: </b>
                              {parsedEffect.target.toLowerCase()}
                            </span>
                          )}
                        {"powerPerLevel" in parsedEffect && (
                          <span>
                            <b>Effect Power / Lvl: </b>
                            {parsedEffect.powerPerLevel}
                          </span>
                        )}
                        {"residualModifier" in parsedEffect && (
                          <span>
                            <b>Residual Modifier: </b>
                            {parsedEffect.residualModifier}
                          </span>
                        )}
                        {(parsedEffect.type === "damage" ||
                          parsedEffect.type === "pierce") && (
                          <>
                            <span>
                              <b>Bloodline damage increase: </b>
                              {parsedEffect.allowBloodlineDamageIncrease ? "Yes" : "No"}
                            </span>
                            <span>
                              <b>Bloodline damage decrease: </b>
                              {parsedEffect.allowBloodlineDamageDecrease ? "Yes" : "No"}
                            </span>
                          </>
                        )}
                        {"generalTypes" in parsedEffect &&
                          parsedEffect.generalTypes &&
                          parsedEffect.generalTypes.length > 0 && (
                            <span>
                              <b>Generals: </b>
                              {parsedEffect.generalTypes.join(", ")}
                            </span>
                          )}
                        {"statTypes" in parsedEffect &&
                          parsedEffect.statTypes &&
                          parsedEffect.statTypes.length > 0 && (
                            <span>
                              <b>Stats: </b>
                              {parsedEffect.statTypes.join(", ")}
                            </span>
                          )}
                        {"elements" in parsedEffect &&
                          parsedEffect.elements &&
                          parsedEffect.elements.length > 0 && (
                            <span className="row-span-2">
                              <b>Elements: </b>
                              <div className="flex flex-row items-center">
                                {parsedEffect.elements.map((element, i) => (
                                  <ElementImage
                                    key={`${element}-${i}`}
                                    element={element}
                                    className="w-8"
                                  />
                                ))}
                              </div>
                            </span>
                          )}
                        {"reward_items" in parsedEffect &&
                          parsedEffect.reward_items &&
                          parsedEffect.reward_items.length > 0 && (
                            <p>
                              <b>Reward Items</b>: {parsedEffect.reward_items.length}
                            </p>
                          )}
                        {"reward_jutsus" in parsedEffect &&
                          parsedEffect.reward_jutsus &&
                          parsedEffect.reward_jutsus.length > 0 && (
                            <p>
                              <b>Reward Jutsus</b>: {parsedEffect.reward_jutsus.length}
                            </p>
                          )}
                        {"reward_bloodlines" in parsedEffect &&
                          parsedEffect.reward_bloodlines &&
                          parsedEffect.reward_bloodlines.length > 0 && (
                            <p>
                              <b>Reward Bloodlines</b>:{" "}
                              {parsedEffect.reward_bloodlines.length}
                            </p>
                          )}
                        {"reward_badges" in parsedEffect &&
                          parsedEffect.reward_badges &&
                          parsedEffect.reward_badges.length > 0 && (
                            <p>
                              <b>Reward Badges</b>: {parsedEffect.reward_badges.length}
                            </p>
                          )}
                        {"reward_money" in parsedEffect &&
                          parsedEffect.reward_money &&
                          parsedEffect.reward_money > 0 && (
                            <p>
                              <b>Reward Money</b>: {parsedEffect.reward_money}
                            </p>
                          )}
                        {"reward_reputation" in parsedEffect &&
                          parsedEffect.reward_reputation &&
                          parsedEffect.reward_reputation > 0 && (
                            <p>
                              <b>Reward Reputation</b>: {parsedEffect.reward_reputation}
                            </p>
                          )}
                        {"reward_rank" in parsedEffect &&
                          parsedEffect.reward_rank &&
                          parsedEffect.reward_rank !== "NONE" && (
                            <p>
                              <b>Reward Rank</b>: {parsedEffect.reward_rank}
                            </p>
                          )}
                        {"reward_village_membership" in parsedEffect &&
                          parsedEffect.reward_village_membership &&
                          parsedEffect.reward_village_membership !== "NONE" && (
                            <p>
                              <b>Reward Village Membership</b>:{" "}
                              {capitalizeFirstLetter(
                                parsedEffect.reward_village_membership,
                              )}
                            </p>
                          )}
                        {"reward_tokens" in parsedEffect &&
                          parsedEffect.reward_tokens &&
                          parsedEffect.reward_tokens > 0 && (
                            <p>
                              <b>Reward Tokens</b>: {parsedEffect.reward_tokens}
                            </p>
                          )}
                        {"reward_prestige" in parsedEffect &&
                          parsedEffect.reward_prestige &&
                          parsedEffect.reward_prestige > 0 && (
                            <p>
                              <b>Reward Prestige</b>: {parsedEffect.reward_prestige}
                            </p>
                          )}
                        {"reward_clanpoints" in parsedEffect &&
                          parsedEffect.reward_clanpoints &&
                          parsedEffect.reward_clanpoints > 0 && (
                            <p>
                              <b>Reward Clanpoints</b>: {parsedEffect.reward_clanpoints}
                            </p>
                          )}
                        {"reward_anbupoints" in parsedEffect &&
                          parsedEffect.reward_anbupoints &&
                          parsedEffect.reward_anbupoints > 0 && (
                            <p>
                              <b>Reward Anbu Points</b>:{" "}
                              {parsedEffect.reward_anbupoints}
                            </p>
                          )}
                        {"reward_exp" in parsedEffect &&
                          parsedEffect.reward_exp &&
                          parsedEffect.reward_exp > 0 && (
                            <p>
                              <b>Reward Exp</b>: {parsedEffect.reward_exp}
                            </p>
                          )}
                        {"reward_seichi_silver" in parsedEffect &&
                          parsedEffect.reward_seichi_silver &&
                          parsedEffect.reward_seichi_silver > 0 && (
                            <p>
                              <b>Reward Seichi Silver</b>:{" "}
                              {parsedEffect.reward_seichi_silver}
                            </p>
                          )}
                        {"reward_hunter_items" in parsedEffect &&
                          parsedEffect.reward_hunter_items && (
                            <p>
                              <b>Reward Hunter Items</b>:{" "}
                              {parsedEffect.reward_hunter_items ? "yes" : "no"}
                            </p>
                          )}
                        {"reward_gathering_items" in parsedEffect &&
                          parsedEffect.reward_gathering_items && (
                            <p>
                              <b>Reward Gathering Items</b>:{" "}
                              {parsedEffect.reward_gathering_items ? "yes" : "no"}
                            </p>
                          )}
                        {"direction" in parsedEffect &&
                          parsedEffect.direction &&
                          (effect.type === "increasestat" ||
                            effect.type === "decreasestat" ||
                            effect.type === "redirection") && (
                            <span>
                              <b>Direction: </b>
                              {parsedEffect.direction.toLowerCase()}
                            </span>
                          )}
                        {"poolsAffected" in parsedEffect &&
                          parsedEffect.poolsAffected &&
                          parsedEffect.poolsAffected.length > 0 &&
                          (effect.type === "increasemaxpools" ||
                            effect.type === "decreasemaxpools" ||
                            effect.type === "drain") && (
                            <span>
                              <b>Pools Affected: </b>
                              {parsedEffect.poolsAffected.join(", ")}
                            </span>
                          )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};

export default ItemWithEffects;
