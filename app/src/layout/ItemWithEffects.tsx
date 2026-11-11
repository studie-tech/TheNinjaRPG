"use client";

import { BarChartBig, MessageSquarePlus, SquarePen, Trash2 } from "lucide-react";
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
  SageMode,
} from "@/drizzle/schema";
import Confirm from "@/layout/Confirm";
import {
  type CloneSource,
  ConfirmedCloneControl,
} from "@/layout/ConfirmedCloneControl";
import ContentImage from "@/layout/ContentImage";
import DurabilityBar from "@/layout/DurabilityBar";
import ElementImage from "@/layout/ElementImage";
import Link from "@/layout/Link";
import { getPotencyDescription, POTENCY_TAG_LABELS } from "@/libs/combat/potency";
import { getPreventTypeName, getStatTypeLabels } from "@/libs/combat/util";
import { EVOLUTION_STAT_FIELDS } from "@/libs/evolution";
import { getFarmPlantExperience } from "@/libs/farming";
import { masteryRewardLabels } from "@/libs/masteryRewards";
import { getQuestRewardSummary } from "@/libs/objectives";
import { cn } from "@/libs/shadui";
import { parseHtml } from "@/utils/parse";
import { canChangeContent, isStaffRole } from "@/utils/permissions";
import {
  capitalizeFirstLetter,
  formatAttackMethod,
  formatAttackTarget,
  formatBattleUsageType,
  formatEnumLabel,
} from "@/utils/string";
import { formatHoursMinutes } from "@/utils/time";
import { useUserDataSelector } from "@/utils/UserContext";
import {
  activityBonusPowerLabel,
  getTagSchema,
  isActivityBonus,
  type ZodAllTags,
} from "@/validators/combat";

export type GenericObject = {
  id: string;
  name: string;
  description: string;
  image?: string;
  rarity?: ItemRarity;
  level?: number;
  experience?: number;
  sector?: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  attacks?: string[];
  effects?: ZodAllTags[];
  village?: { name: string };
  href?: string;
};

/** Editors that open in suggest mode for staff who cannot save content. */
const SUGGESTABLE_CONTENT: readonly string[] = [
  "jutsu",
  "item",
  "bloodline",
  "quest",
  "badge",
  "asset",
  "ai",
];

export interface ItemWithEffectsProps {
  item:
    | Bloodline
    | SageMode
    | (Item & {
        imbuements?: Item[];
        curDurability?: number;
        level?: number;
        experience?: number;
      })
    | Jutsu
    | Quest
    | GameAsset
    | GenericObject;
  hideDetails?: boolean;
  showEvolutions?: boolean;
  imageExtra?: React.ReactNode;
  /** Status message shown inside the card, under the entry's title. */
  notice?: React.ReactNode;
  /** Actions shown after the entry's description, requirements and effects. */
  footer?: React.ReactNode;
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
    | "skillTree"
    | "sageMode";
  showStatistic?: "bloodline" | "item" | "jutsu" | "ai";
  showCopy?: "quest" | "ai" | "item" | "jutsu";
  hideTitle?: boolean;
  /** Turns the entry name into a link to its own page, so list views give search
   *  engines a crawlable path to each piece of content. */
  detailHref?: string;
  hideImage?: boolean;
  hideEffects?: boolean;
  hideDates?: boolean;
  /** Player-facing listing: skips editor metadata such as dates, author and visibility. */
  playerView?: boolean;
  hideData?: boolean;
  onDelete?: (id: string) => void;
  folderName?: string;
}

/** Clone the confirmed quest, refresh its listing, and open the saved copy's editor. */
const QuestCloneControl: React.FC<{ source: CloneSource }> = ({ source }) => {
  const router = useRouter();
  const utils = api.useUtils();
  const { mutateAsync: cloneQuest, isPending } = api.quests.clone.useMutation();

  return (
    <ConfirmedCloneControl
      source={source}
      label="quest"
      isPending={isPending}
      clone={(id) => cloneQuest({ id })}
      onCloned={(cloneId) => {
        void Promise.allSettled([
          utils.quests.getAll.invalidate(),
          utils.quests.getAllNames.invalidate(),
          utils.quests.get.invalidate({ id: cloneId }),
        ]);
        router.push(`/manual/quest/edit/${cloneId}`);
      }}
      body={({ name }) => (
        <>
          <p>
            This creates a separate copy of <b>{name}</b>, including its objectives and
            rewards. The original quest will not be changed.
          </p>
          <p>You will be taken to the new copy to review and edit it.</p>
        </>
      )}
    />
  );
};

/** Clone the confirmed AI, refresh its listing, and open the saved copy's editor. */
const AiCloneControl: React.FC<{ source: CloneSource }> = ({ source }) => {
  const router = useRouter();
  const utils = api.useUtils();
  const { mutateAsync: cloneAi, isPending } = api.profile.cloneAi.useMutation();

  return (
    <ConfirmedCloneControl
      source={source}
      label="AI"
      isPending={isPending}
      clone={(id) => cloneAi({ id })}
      onCloned={(cloneId) => {
        void Promise.allSettled([
          utils.profile.getPublicUsers.invalidate(),
          utils.profile.getAllAiNames.invalidate(),
          utils.profile.getAi.invalidate({ userId: cloneId }),
        ]);
        router.push(`/manual/ai/edit/${cloneId}`);
      }}
      body={({ name }) => (
        <>
          <p>
            This creates a separate copy of <b>{name}</b>, including its jutsu, items,
            and nindo. The original AI will not be changed.
          </p>
          <p>You will be taken to the new copy to review and edit it.</p>
        </>
      )}
    />
  );
};

/** Clone the confirmed item, refresh its listing, and open the saved copy's editor. */
const ItemCloneControl: React.FC<{ source: CloneSource }> = ({ source }) => {
  const router = useRouter();
  const utils = api.useUtils();
  const { mutateAsync: cloneItem, isPending } = api.item.clone.useMutation();

  return (
    <ConfirmedCloneControl
      source={source}
      label="item"
      isPending={isPending}
      clone={(id) => cloneItem({ id })}
      onCloned={(cloneId) => {
        void Promise.allSettled([
          utils.item.getAll.invalidate(),
          utils.item.getAllNames.invalidate(),
          utils.item.get.invalidate({ id: cloneId }),
          utils.item.getItemWithCraftingRequirements.invalidate({ id: cloneId }),
        ]);
        router.push(`/manual/item/edit/${cloneId}`);
      }}
      body={({ name }) => (
        <>
          <p>
            This creates a separate copy of <b>{name}</b>, including its crafting
            recipe. The original item will not be changed.
          </p>
          <p>You will be taken to the new copy to review and edit it.</p>
        </>
      )}
    />
  );
};

/** Clone the confirmed jutsu, refresh its listing, and open the saved copy's editor. */
const JutsuCloneControl: React.FC<{ source: CloneSource }> = ({ source }) => {
  const router = useRouter();
  const utils = api.useUtils();
  const { mutateAsync: cloneJutsu, isPending } = api.jutsu.clone.useMutation();

  return (
    <ConfirmedCloneControl
      source={source}
      label="jutsu"
      isPending={isPending}
      clone={(id) => cloneJutsu({ id })}
      onCloned={(cloneId) => {
        void Promise.allSettled([
          utils.jutsu.getAll.invalidate(),
          utils.jutsu.getAllNames.invalidate(),
          utils.jutsu.get.invalidate({ id: cloneId }),
        ]);
        router.push(`/manual/jutsu/edit/${cloneId}`);
      }}
      body={({ name }) => (
        <>
          <p>
            This creates a hidden copy of <b>{name}</b>, including its effects and
            requirements. The original jutsu will not be changed.
          </p>
          <p>
            Evolution and reskin links are cleared. The copy keeps its current rank and
            mechanics, including H-rank for linked reskins, but no longer receives
            parent updates. You will be taken to the new copy to review and edit it.
          </p>
        </>
      )}
    />
  );
};

const ItemWithEffects: React.FC<ItemWithEffectsProps> = (props) => {
  const {
    item,
    showEdit,
    showStatistic,
    showCopy,
    hideTitle,
    detailHref,
    hideDetails,
    showEvolutions,
    hideImage,
    hideEffects,
    hideDates,
    playerView,
    hideData,
    onDelete,
    folderName,
  } = props;
  // Only the role decides staff links, so other profile changes do not re-render each card.
  const { data: role } = useUserDataSelector((user) => user.role);
  const isFurniture = "itemType" in item && item.itemType === "FURNITURE";

  // Get bloodline / sage-mode names for requirement labels
  const { data: bloodlinesData } = api.bloodline.getAllNames.useQuery();
  const { data: sageModesData } = api.sageMode.getAllNames.useQuery();
  const requiredSkillId =
    !isFurniture && "requiredSkillId" in item ? item.requiredSkillId : null;
  const { data: skillNames } = api.skillTree.getAllNames.useQuery(undefined, {
    enabled: !!requiredSkillId,
  });

  // Only fetch evolutions when the caller explicitly opts in, to avoid N+1 queries
  // in list views. Pass showEvolutions={true} for single-item detail views (e.g.
  // the jutsus/traininggrounds/items modals) where the evolution chain is meaningful.
  const isJutsuItem = "jutsuType" in item;
  const isGameItem = "itemType" in item && !("jutsuType" in item) && !isFurniture;
  const farmYieldItemId = "farmYieldItemId" in item ? item.farmYieldItemId : null;
  const farmExtractSeedItemId =
    "farmExtractSeedItemId" in item ? item.farmExtractSeedItemId : null;
  const { data: itemNames } = api.item.getAllNames.useQuery(undefined, {
    enabled: !!farmYieldItemId || !!farmExtractSeedItemId,
    staleTime: 5 * 60 * 1000,
  });
  const farmYieldItemName = itemNames?.find(
    (itemName) => itemName.id === farmYieldItemId,
  )?.name;
  const farmExtractSeedItemName = itemNames?.find(
    (itemName) => itemName.id === farmExtractSeedItemId,
  )?.name;
  // SageMode rows carry a `requiredSageMastery` that gates their level-2 effects behind
  // `userData.sageMasteryExperience`, which is a different thing from the Sage Mastery
  // stat requirement of the same name on Item/Jutsu. Discriminate before rendering either.
  const isSageMode = "activationRounds" in item;
  // General stat gates are listed only where evolving checks them
  const isEvolutionRow =
    ("parentJutsuId" in item && !!item.parentJutsuId) ||
    ("parentItemId" in item && !!item.parentItemId);
  const { data: jutsuEvolutions } = api.jutsu.getEvolutions.useQuery(
    { jutsuId: item.id },
    { enabled: isJutsuItem && !hideData && !!showEvolutions, staleTime: 5 * 60 * 1000 },
  );
  const { data: itemEvolutions } = api.item.getEvolutions.useQuery(
    { itemId: item.id },
    { enabled: isGameItem && !hideData && !!showEvolutions, staleTime: 5 * 60 * 1000 },
  );
  const evolutionsData = isJutsuItem ? jutsuEvolutions : itemEvolutions;

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
    ...("afterEffects" in props.item && props.item.afterEffects
      ? (props.item.afterEffects as Omit<ZodAllTags, "description">[]).map(
          (effect, idx) => ({
            ...effect,
            color: "bg-orange-200",
            sourceLabel: `After Effect ${idx + 1}`,
          }),
        )
      : []),
    ...("level2Effects" in props.item && props.item.level2Effects
      ? (props.item.level2Effects as Omit<ZodAllTags, "description">[]).map(
          (effect, idx) => ({
            ...effect,
            color: "bg-amber-200",
            sourceLabel: `Level 2 Effect ${idx + 1}`,
          }),
        )
      : []),
  ];

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
          {!isFurniture &&
            "maxDurability" in item &&
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
      </div>
    ) : null;
  if ("href" in item && item.href) {
    image = <Link href={item.href}>{image}</Link>;
  }
  const imageExtra = props.imageExtra;

  // Define rewards from quests if they are there
  const rewardSummary =
    "content" in item && item.content ? getQuestRewardSummary(item.content) : undefined;
  return (
    <div className="mb-3 flex flex-row items-center rounded-lg border bg-popover p-2 align-middle shadow-sm">
      {!hideImage && <div className="mx-3 hidden basis-1/3 md:block">{image}</div>}

      <div className={cn("basis-full text-sm", hideImage || "md:basis-2/3")}>
        {/* Phones stack the image above the text so the text keeps the card's width. */}
        <div className="flex flex-col sm:flex-row">
          {!hideImage && (
            <div className="relative mx-auto mb-2 block w-28 shrink-0 sm:mx-0 sm:mb-0 sm:w-auto md:hidden md:basis-1/3">
              {image}
            </div>
          )}

          <div className="relative flex min-w-0 basis-full flex-col sm:pl-5 md:pl-0">
            {imageExtra && <div className="flex flex-row">{imageExtra}</div>}
            <div className="flex items-start justify-between gap-2">
              {!hideTitle ? (
                <h3 className="wrap-break-word min-w-0 flex-1 font-bold text-popover-foreground text-xl tracking-tight">
                  {detailHref ? (
                    <Link className="hover:text-orange-500" href={detailHref}>
                      {item.name}
                    </Link>
                  ) : (
                    item.name
                  )}
                </h3>
              ) : (
                <br />
              )}
              <div className="flex max-w-[50%] shrink-0 flex-wrap justify-end">
                {showStatistic && (
                  <Link
                    href={`/manual/${showStatistic}/statistics/${item.id}`}
                    className="mr-1"
                  >
                    <BarChartBig className="h-6 w-6 hover:text-popover-foreground/50" />
                  </Link>
                )}
                {showEdit && role && canChangeContent(role) && (
                  <>
                    {showCopy === "quest" && (
                      <QuestCloneControl
                        key={item.id}
                        source={{ id: item.id, name: item.name }}
                      />
                    )}
                    {showCopy === "ai" && (
                      <AiCloneControl
                        key={item.id}
                        source={{ id: item.id, name: item.name }}
                      />
                    )}
                    {showCopy === "item" && (
                      <ItemCloneControl
                        key={item.id}
                        source={{ id: item.id, name: item.name }}
                      />
                    )}
                    {showCopy === "jutsu" && (
                      <JutsuCloneControl
                        key={item.id}
                        source={{ id: item.id, name: item.name }}
                      />
                    )}
                    <Link
                      href={`/manual/${showEdit}/edit/${item.id}`}
                      aria-label={`Edit ${item.name}`}
                    >
                      <SquarePen className="h-6 w-6 hover:text-popover-foreground/50" />
                    </Link>
                    {onDelete && (
                      <Confirm
                        title={`Delete ${item.name}?`}
                        triggerLabel={`Delete ${item.name}`}
                        button={
                          <Trash2 className="h-6 w-6 hover:cursor-pointer hover:text-popover-foreground/50" />
                        }
                        tone="destructive"
                        proceed_label="Delete for all players"
                        onAccept={(e) => {
                          e.preventDefault();
                          onDelete(item.id);
                        }}
                      >
                        Delete {item.name} from the game? Every player who has it loses
                        it. This cannot be undone.
                      </Confirm>
                    )}
                  </>
                )}
                {showEdit &&
                  SUGGESTABLE_CONTENT.includes(showEdit) &&
                  role &&
                  isStaffRole(role) &&
                  !canChangeContent(role) && (
                    <Link
                      href={`/manual/${showEdit}/edit/${item.id}`}
                      aria-label="Suggest a change"
                      title="Suggest a change"
                    >
                      <MessageSquarePlus className="h-6 w-6 hover:text-popover-foreground/50" />
                    </Link>
                  )}
              </div>
            </div>
            {props.notice && <div className="my-1">{props.notice}</div>}
            {!hideDetails && !hideDates && !playerView && (
              <div className="flex flex-row flex-wrap gap-2">
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

            <hr className="py-1" />
            {!hideDetails && "description" in item && item.description && (
              <div data-reading-text>{parseHtml(item.description)}</div>
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
          {!hideData && isFurniture && (
            <FurnitureDetails
              item={item as Item}
              showHidden={!!role && canChangeContent(role)}
            />
          )}
          {!hideData && !isFurniture && (
            <div className="my-2 grid grid-cols-2 rounded-lg bg-poppopover p-2 text-sm md:text-base">
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
              {"canBeImbued" in item &&
                item.canBeImbued &&
                "maxImbueNumber" in item &&
                item.maxImbueNumber > 0 && (
                  <p>
                    <b>Max Imbue Number</b>: {item.maxImbueNumber}
                  </p>
                )}
              {"canBeImbued" in item && item.canBeImbued && (
                <p>
                  <b>Can be Imbued</b>: yes
                </p>
              )}
              {"canBeHunted" in item && item.canBeHunted && (
                <p>
                  <b>Can be Hunted</b>: yes
                </p>
              )}
              {"canBeGathered" in item && item.canBeGathered && (
                <p>
                  <b>Can be Gathered</b>: yes
                </p>
              )}
              {"canBeTraded" in item && item.canBeTraded && (
                <p>
                  <b>Can be Traded</b>: yes
                </p>
              )}
              {"canBeCrafted" in item && item.canBeCrafted && (
                <p>
                  <b>Can be Crafted</b>: yes
                </p>
              )}
              {"isFarmSeed" in item && item.isFarmSeed && (
                <p>
                  <b>Farm Seed</b>: grow {formatHoursMinutes(item.farmGrowTimeSeconds)}{" "}
                  · min grow lvl {item.farmMinLevel}
                  {getFarmPlantExperience(item) > 0
                    ? ` · plant ${getFarmPlantExperience(item)} XP`
                    : ""}
                  {farmYieldItemName ? ` · yields ${farmYieldItemName}` : ""}
                  {item.farmSellValue > 0
                    ? ` · farm shop ${item.farmSellValue} coins`
                    : ""}
                  {item.inShop && role && canChangeContent(role)
                    ? " · ⚠ also in item shop (should be off)"
                    : ""}
                </p>
              )}
              {"farmSellValue" in item &&
                item.farmSellValue > 0 &&
                !item.isFarmSeed &&
                !item.isFarmFertilizer && (
                  <p>
                    <b>Farm Sell Value</b>: {item.farmSellValue} coins
                    {"farmHarvestExperience" in item && item.farmHarvestExperience > 0
                      ? ` · harvest ${item.farmHarvestExperience} XP`
                      : ""}
                  </p>
                )}
              {"farmExtractSeedCount" in item && item.farmExtractSeedCount > 0 && (
                <p>
                  <b>Seed Extraction</b>: {item.farmExtractSeedCount}{" "}
                  {farmExtractSeedItemName ?? "seeds"}
                </p>
              )}
              {"isFarmFertilizer" in item && item.isFarmFertilizer && (
                <p>
                  <b>Farm Fertilizer</b>: −{item.farmTimeReductionSeconds}s grow time
                  {"farmFertilizerExperience" in item &&
                  item.farmFertilizerExperience > 0
                    ? ` · apply ${item.farmFertilizerExperience} XP`
                    : ""}
                </p>
              )}
              {"statClassification" in item && item.statClassification && (
                <p>
                  <b>Class</b>: {capitalizeFirstLetter(item.statClassification)}
                </p>
              )}
              {"elementClassification" in item && (
                <p>
                  <b>Element Classification</b>: {item.elementClassification ?? "None"}
                </p>
              )}
              {"difficulty" in item && item.difficulty && (
                <p>
                  <b>Difficulty</b>: {item.difficulty}
                </p>
              )}

              {"level" in item &&
                item.level !== undefined &&
                item.level > 0 &&
                !isSageMode && (
                  <p>
                    <b>Level</b>: {item.level}
                  </p>
                )}
              {isSageMode &&
                "requiredSageMastery" in item &&
                item.requiredSageMastery > 0 && (
                  <p>
                    <b>Lvl 2 Mastery</b>: {item.requiredSageMastery.toLocaleString()}
                  </p>
                )}
              {"activationRounds" in item && item.activationRounds > 0 && (
                <p>
                  <b>Active Duration</b>: {item.activationRounds} rounds
                </p>
              )}
              {"afterEffectRounds" in item && item.afterEffectRounds > 0 && (
                <p>
                  <b>After-Effect Duration</b>: {item.afterEffectRounds} rounds
                </p>
              )}
              {"chakraCostPerc" in item && item.chakraCostPerc > 0 && (
                <p>
                  <b>Chakra Cost</b>: {item.chakraCostPerc}%
                </p>
              )}
              {"staminaCostPerc" in item && item.staminaCostPerc > 0 && (
                <p>
                  <b>Stamina Cost</b>: {item.staminaCostPerc}%
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
                  <b>Type</b>: {formatEnumLabel(item.type)}
                </p>
              )}
              {"onInitialBattleField" in item && item.onInitialBattleField && (
                <p>
                  <b>On battlefield</b>: yes
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
                "inShrines" in item &&
                Boolean(
                  item.inArena || item.isSummon || item.isEvent || item.inShrines,
                ) && (
                  <p>
                    <b>Classification</b>:{" "}
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
                  <b>Item type</b>: {formatEnumLabel(item.itemType)}
                </p>
              )}
              {"hidden" in item && !playerView && role && canChangeContent(role) && (
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
                  <b>Target</b>: {formatAttackTarget(item.target)}
                </p>
              )}
              {"method" in item && (
                <p>
                  <b>Method</b>: {formatAttackMethod(item.method)}
                </p>
              )}
              {"weaponType" in item && item.weaponType && (
                <p>
                  <b>Weapon</b>: {formatEnumLabel(item.weaponType)}
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
                  <b>Equip</b>: {formatEnumLabel(item.slot)}
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
              {"xpToLevel" in item &&
                typeof item.xpToLevel === "number" &&
                item.xpToLevel > 0 && (
                  <p>
                    <b>XP Per Level</b>: {item.xpToLevel}
                  </p>
                )}
              {requiredSkillId && (
                <p>
                  <b>Required Skill</b>:{" "}
                  {skillNames?.find((s) => s.id === requiredSkillId)?.name ||
                    requiredSkillId}{" "}
                  (activated)
                </p>
              )}
              {"bloodlineId" in item && item.bloodlineId && (
                <p>
                  <b>Required Bloodline</b>:{" "}
                  {bloodlinesData?.find((b) => b.id === item.bloodlineId)?.name ||
                    item.bloodlineId}
                </p>
              )}
              {"requiredSageModeId" in item && item.requiredSageModeId && (
                <p>
                  <b>Required Sage Mode</b>:{" "}
                  {sageModesData?.find((s) => s.id === item.requiredSageModeId)?.name ||
                    item.requiredSageModeId}
                </p>
              )}
              {"parentJutsuId" in item && item.parentJutsuId && (
                <p className="col-span-2">
                  <b>Evolution</b>: Yes (evolves from a parent jutsu)
                </p>
              )}
              {"parentItemId" in item && item.parentItemId && (
                <p className="col-span-2">
                  <b>Evolution</b>: Yes (evolves from a parent item)
                </p>
              )}
              {EVOLUTION_STAT_FIELDS.filter(({ id, evolveOnly }) => {
                if (id === "requiredSageMastery" && isSageMode) return false;
                if (evolveOnly && !isEvolutionRow) return false;
                return (item as unknown as Record<string, unknown>)[id] != null;
              }).map(({ id, label, evolveOnly }) => {
                const value = (item as unknown as Record<string, number>)[id];
                return evolveOnly ? (
                  <p key={id}>
                    <b>Req. to evolve</b>: {value?.toLocaleString()} {label}
                  </p>
                ) : (
                  <p key={id}>
                    <b>Req. {label}</b>: {value?.toLocaleString()}
                  </p>
                );
              })}
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
              {rewardSummary && (
                <div className="col-span-2">
                  <b>{rewardSummary.label}</b>: {rewardSummary.rewards.join(", ")}
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
          {"medicalRank" in item && (
            <RankRequirement label="Medical" rank={item.medicalRank} />
          )}
          {"huntingRank" in item && (
            <RankRequirement label="Hunting" rank={item.huntingRank} />
          )}
          {"gatheringRank" in item && (
            <RankRequirement label="Gathering" rank={item.gatheringRank} />
          )}
          {"requiredSageRank" in item && (
            <RankRequirement label="Sage" rank={item.requiredSageRank} />
          )}
          {!isFurniture &&
            !hideEffects &&
            effects?.map((effect, i) => {
              // Get schema for parsing effect
              const schema = getTagSchema(effect.type);
              // Delete description, so that we get the default one
              if ("description" in effect) delete effect.description;
              const result = schema.safeParse(effect);
              const parsedEffect = result.success ? result.data : undefined;

              if (
                parsedEffect?.type === "noncombatconsumereward" &&
                parsedEffect.rewardMode === "weightedCache" &&
                parsedEffect.weightedCache
              ) {
                const cache = parsedEffect.weightedCache;
                return (
                  <div key={effect.type + i.toString()} className="my-2 rounded-lg p-2">
                    <b>{cache.displayName}</b>
                    <p>Open to receive item rewards.</p>
                    <p>
                      {cache.rolls
                        .map(
                          (roll) =>
                            `${roll.count} roll${roll.count === 1 ? "" : "s"}: ${roll.probability / 100}%`,
                        )
                        .join("; ")}
                    </p>
                  </div>
                );
              }

              // Include the configured target of selective effects in descriptions.
              const getEffectDescription = () => {
                if (
                  parsedEffect?.type === "increasepotency" ||
                  parsedEffect?.type === "decreasepotency"
                ) {
                  return getPotencyDescription(parsedEffect);
                }
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
                        <b>
                          {"sourceLabel" in effect &&
                          typeof effect.sourceLabel === "string"
                            ? effect.sourceLabel
                            : `Effect ${i + 1}`}
                          :{" "}
                        </b>{" "}
                        <i>{getEffectDescription()}</i>
                      </div>
                      <div className="grid grid-cols-2">
                        {"rounds" in parsedEffect &&
                          parsedEffect.rounds !== undefined &&
                          !("shieldRounds" in parsedEffect) && (
                            <span>
                              <b>Rounds: </b> {parsedEffect.rounds}
                            </span>
                          )}
                        {"shieldRounds" in parsedEffect &&
                          parsedEffect.shieldRounds !== undefined && (
                            <span>
                              <b>Shield Rounds: </b> {parsedEffect.shieldRounds}
                            </span>
                          )}
                        {parsedEffect.type === "diffuse" && (
                          <span>
                            <b>Repayment Turns: </b> {parsedEffect.delayRounds}
                          </span>
                        )}
                        {"calculation" in parsedEffect && (
                          <span>
                            <b>Calculation: </b>
                            {parsedEffect.calculation}
                          </span>
                        )}
                        {"aggroMode" in parsedEffect && (
                          <span>
                            <b>Aggro mode: </b>
                            {parsedEffect.aggroMode === "ENMITY"
                              ? "Current enmity"
                              : "Enmity generation"}
                          </span>
                        )}
                        {"blocks" in parsedEffect && parsedEffect.blocks && (
                          <span>
                            <b>Blocks: </b>
                            {`${getPreventTypeName(parsedEffect.blocks as string)} prevention`}
                          </span>
                        )}
                        {"affectedTag" in parsedEffect && (
                          <span>
                            <b>Affected Tag: </b>
                            {POTENCY_TAG_LABELS[parsedEffect.affectedTag]}
                          </span>
                        )}
                        {"affectedElements" in parsedEffect && (
                          <span>
                            <b>Affected Elements: </b>
                            {parsedEffect.affectedElements.length > 0
                              ? parsedEffect.affectedElements.join(", ")
                              : "All (including non-elemental)"}
                          </span>
                        )}
                        {"power" in parsedEffect && (
                          <span>
                            <b>
                              {isActivityBonus(parsedEffect)
                                ? activityBonusPowerLabel(parsedEffect)
                                : parsedEffect.type === "increasejutsuslots"
                                  ? "Additional jutsu slots"
                                  : "Effect Power"}
                              :{" "}
                            </b>
                            {parsedEffect.power}
                          </span>
                        )}
                        {parsedEffect.type === "curse" && (
                          <span>
                            <b>Damage Bonus: </b>
                            {parsedEffect.damageBonusPercent}%
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
                        {"powerPerLevel" in parsedEffect &&
                          parsedEffect.type !== "increasejutsuslots" &&
                          !isActivityBonus(parsedEffect) && (
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
                          parsedEffect.type === "elementaldamage" ||
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
                              {getStatTypeLabels(parsedEffect).join(", ")}
                            </span>
                          )}
                        {"masteryTypes" in parsedEffect &&
                          parsedEffect.masteryTypes &&
                          parsedEffect.masteryTypes.length > 0 && (
                            <span>
                              <b>Masteries: </b>
                              {parsedEffect.masteryTypes.join(", ")}
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
                        {"reward_sage_modes" in parsedEffect &&
                          parsedEffect.reward_sage_modes &&
                          parsedEffect.reward_sage_modes.length > 0 && (
                            <p>
                              <b>Reward Sage Modes</b>:{" "}
                              {parsedEffect.reward_sage_modes.length}
                            </p>
                          )}
                        {"reward_titles" in parsedEffect &&
                          parsedEffect.reward_titles &&
                          parsedEffect.reward_titles.length > 0 && (
                            <div>
                              <b>Reward Titles</b>: {parsedEffect.reward_titles.length}
                            </div>
                          )}
                        {"reward_badges" in parsedEffect &&
                          parsedEffect.reward_badges &&
                          parsedEffect.reward_badges.length > 0 && (
                            <p>
                              <b>Reward Badges</b>: {parsedEffect.reward_badges.length}
                            </p>
                          )}
                        {"reward_money" in parsedEffect &&
                          (parsedEffect.reward_money ?? 0) > 0 && (
                            <p>
                              <b>Reward Money</b>: {parsedEffect.reward_money}
                            </p>
                          )}
                        {"reward_reputation" in parsedEffect &&
                          (parsedEffect.reward_reputation ?? 0) > 0 && (
                            <p>
                              <b>Reward Reputation</b>: {parsedEffect.reward_reputation}
                            </p>
                          )}
                        {"reward_money" in parsedEffect &&
                          masteryRewardLabels(parsedEffect).map((label) => (
                            <p key={label}>{label}</p>
                          ))}
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
                          (parsedEffect.reward_tokens ?? 0) > 0 && (
                            <p>
                              <b>Reward Tokens</b>: {parsedEffect.reward_tokens}
                            </p>
                          )}
                        {"reward_prestige" in parsedEffect &&
                          (parsedEffect.reward_prestige ?? 0) > 0 && (
                            <p>
                              <b>Reward Prestige</b>: {parsedEffect.reward_prestige}
                            </p>
                          )}
                        {"reward_clanpoints" in parsedEffect &&
                          (parsedEffect.reward_clanpoints ?? 0) > 0 && (
                            <p>
                              <b>Reward Clanpoints</b>: {parsedEffect.reward_clanpoints}
                            </p>
                          )}
                        {"reward_anbupoints" in parsedEffect &&
                          (parsedEffect.reward_anbupoints ?? 0) > 0 && (
                            <p>
                              <b>Reward Anbu Points</b>:{" "}
                              {parsedEffect.reward_anbupoints}
                            </p>
                          )}
                        {"reward_pet_experience" in parsedEffect &&
                          (parsedEffect.reward_pet_experience ?? 0) > 0 && (
                            <p>
                              <b>Pet Experience</b>:{" "}
                              {parsedEffect.reward_pet_experience}
                            </p>
                          )}
                        {"reward_exp" in parsedEffect &&
                          (parsedEffect.reward_exp ?? 0) > 0 && (
                            <p>
                              <b>Reward Exp</b>: {parsedEffect.reward_exp}
                            </p>
                          )}
                        {"reward_sage_mastery_experience" in parsedEffect &&
                          (parsedEffect.reward_sage_mastery_experience ?? 0) > 0 && (
                            <p>
                              <b>Reward Sage Mode Exp</b>:{" "}
                              {parsedEffect.reward_sage_mastery_experience.toLocaleString()}
                            </p>
                          )}
                        {"reward_seichi_silver" in parsedEffect &&
                          (parsedEffect.reward_seichi_silver ?? 0) > 0 && (
                            <p>
                              <b>Reward Seichi Silver</b>:{" "}
                              {parsedEffect.reward_seichi_silver}
                            </p>
                          )}
                        {"reward_skillpoints" in parsedEffect &&
                          (parsedEffect.reward_skillpoints ?? 0) > 0 && (
                            <p>
                              <b>Reward Skill Points</b>:{" "}
                              {parsedEffect.reward_skillpoints}
                            </p>
                          )}
                        {"reward_hunter_items" in parsedEffect &&
                          parsedEffect.reward_hunter_items && (
                            <p>
                              <b>Reward Hunter Items</b>: yes
                            </p>
                          )}
                        {"reward_gathering_items" in parsedEffect &&
                          parsedEffect.reward_gathering_items && (
                            <p>
                              <b>Reward Gathering Items</b>: yes
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
        {props.footer && <div className="mt-3 border-t pt-3">{props.footer}</div>}
      </div>
    </div>
  );
};

export default ItemWithEffects;

/** Shows furniture's home and shop metadata without equipment or battle statistics. */
/** Highlighted rank a quest requires, unless it requires none. */
const RankRequirement = ({ label, rank }: { label: string; rank: string | null }) =>
  rank && rank !== "NONE" ? (
    <div className="my-2 rounded-lg bg-poppopover p-2">
      <p>
        <b>{label} Rank Requirement</b>: {rank}
      </p>
    </div>
  ) : null;

const FurnitureDetails = ({
  item,
  showHidden,
}: {
  item: Item;
  showHidden: boolean;
}) => (
  <div className="my-2 grid grid-cols-2 rounded-lg bg-poppopover p-2 text-sm md:text-base">
    <p>
      <b>Item type</b>: furniture
    </p>
    <p>
      <b>Rarity</b>: {capitalizeFirstLetter(item.rarity)}
    </p>
    <p>
      <b>Home action</b>:{" "}
      {item.furnitureData?.action
        ? capitalizeFirstLetter(item.furnitureData?.action)
        : "Decoration"}
    </p>
    <p>
      <b>Floor decoration</b>: {item.furnitureData?.isFloor ? "yes" : "no"}
    </p>
    <p>
      <b>Required Level</b>: {item.requiredLevel}
    </p>
    <p>
      <b>Can be Crafted</b>: {item.canBeCrafted ? "yes" : "no"}
    </p>
    <p>
      <b>Can be Traded</b>: {item.canBeTraded ? "yes" : "no"}
    </p>
    {showHidden && (
      <p>
        <b>Hidden</b>: {item.hidden ? "yes" : "no"}
      </p>
    )}
    {item.cost > 0 && (
      <p className="col-span-2">
        <b>Shop Price:</b> {item.cost.toLocaleString()} ryo
      </p>
    )}
    {item.repsCost > 0 && (
      <p className="col-span-2">
        <b>Shop Price:</b> {item.repsCost.toLocaleString()} reputation points
      </p>
    )}
    {item.seichiSilverCost > 0 && (
      <p className="col-span-2">
        <b>Shop Price:</b> {item.seichiSilverCost.toLocaleString()} seichi silver
      </p>
    )}
    {item.purchaseLimitPeriod !== "NONE" && item.purchaseLimit != null && (
      <p className="col-span-2">
        <b>Purchase limit</b>: {item.purchaseLimit}{" "}
        {item.purchaseLimitPeriod.toLowerCase()}
      </p>
    )}
  </div>
);
