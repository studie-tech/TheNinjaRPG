import React from "react";
import Link from "next/link";
import ContentImage from "@/layout/ContentImage";
import Confirm2 from "@/layout/Confirm2";
import { parseHtml } from "@/utils/parse";
import ElementImage from "@/layout/ElementImage";
import { canChangeCombatBgScheme, canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import { SquarePen, Trash2, BarChartBig, Copy, Box } from "lucide-react";
import { getTagSchema } from "@/libs/combat/types";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import { showMutationToast } from "@/libs/toast";
import { cn } from "src/libs/shadui";
import { api } from "@/app/_trpc/client";
import { useRouter } from "next/navigation";
import Model3d from "@/layout/Model3d";
import type { ItemRarity, GameAsset } from "@/drizzle/schema";
import type { Bloodline, Item, Jutsu, Quest } from "@/drizzle/schema";
import type { ZodAllTags } from "@/libs/combat/types";
import type { BackgroundSchema } from "@/drizzle/schema";
import { getRewardArray } from "@/libs/objectives";

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
  attacks?: string[];
  effects?: ZodAllTags[];
  village?: { name: string };
  href?: string;
};

export interface ItemWithEffectsProps {
  item: Bloodline | Item | Jutsu | Quest | BackgroundSchema | GameAsset | GenericObject;
  hideDetails?: boolean;
  imageBorder?: boolean;
  imageExtra?: React.ReactNode;
  showEdit?:
    | "bloodline"
    | "item"
    | "jutsu"
    | "ai"
    | "quest"
    | "badge"
    | "asset"
    | "backgroundSchema";
  showStatistic?: "bloodline" | "item" | "jutsu" | "ai";
  showCopy?: "quest" | "ai";
  show3d?: boolean;
  hideTitle?: boolean;
  hideImage?: boolean;
  onDelete?: (id: string) => void;
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
    hideImage,
    onDelete,
  } = props;
  const { data: userData } = useUserData();
  const router = useRouter();

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

  // Extract effects if they exist
  const effects =
    "effects" in props.item
      ? (props.item.effects as Omit<ZodAllTags, "description">[])
      : [];

  // Extract objectives if they exist
  const objectives = "content" in props.item ? props.item.content.objectives : [];
  // Define image
  let image =
    "image" in item ? (
      <div className="relative flex flex-col items-center justify-center">
        <ContentImage
          image={item.image}
          frames={"frames" in item ? item.frames : undefined}
          speed={"speed" in item ? item.speed : undefined}
          rarity={"rarity" in item ? item.rarity : undefined}
          alt={item.name}
          className=""
        />
        {props.imageExtra}
      </div>
    ) : null;
  if ("href" in item && item.href) {
    image = <Link href={item.href}>{image}</Link>;
  }

  // Define rewards from quests if they are there
  const rewards = "content" in item ? getRewardArray(item.content.reward) : [];

  return (
    <div className="mb-3 flex flex-row items-center rounded-lg border bg-popover p-2 align-middle shadow-sm ">
      {!hideDetails && !hideImage && (
        <div className="mx-3 hidden basis-1/3 md:block">{image}</div>
      )}

      <div
        className={cn("basis-full text-sm", hideDetails || hideImage || "md:basis-2/3")}
      >
        <div className="flex flex-row">
          {!hideImage && (
            <div className="relative block md:hidden md:basis-1/3">{image}</div>
          )}

          <div className="relative flex basis-full flex-col pl-5 md:pl-0">
            {!hideTitle ? (
              <h3 className="text-xl font-bold tracking-tight text-popover-foreground">
                {item.name}
              </h3>
            ) : (
              <br />
            )}
            {!hideDetails && (
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
                  {show3d && "avatar" in item && "avatar3d" in item && item.avatar3d ? (
                    <Confirm2
                      title="3d Model"
                      button={
                        <Box className="h-6 w-6 hover:text-popover-foreground/50 hover:cursor-pointer" />
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
                  {onDelete && canChangeCombatBgScheme(userData.role) && (
                    <Confirm2
                      title="Confirm Deletion"
                      button={
                        <Trash2 className="h-6 w-6 hover:text-popover-foreground/50 hover:cursor-pointer" />
                      }
                      onAccept={(e) => {
                        e.preventDefault();
                        if (onDelete) onDelete(item.id);
                      }}
                    >
                      You are about to delete this. Are you sure?
                    </Confirm2>
                  )}
                </>
              )}
            </div>

            <hr className="py-1" />
            {!hideDetails && "description" in item && item.description && (
              <div>{parseHtml(item.description)}</div>
            )}
          </div>
        </div>
        <div>
          <div className="my-2 grid grid-cols-2 rounded-lg bg-poppopover p-2">
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
            {"rarity" in item && item.rarity && (
              <p>
                <b>Rarity</b>: {capitalizeFirstLetter(item.rarity)}
              </p>
            )}
            {"statClassification" in item && item.statClassification && (
              <p>
                <b>Class</b>: {capitalizeFirstLetter(item.statClassification)}
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
            {"inArena" in item && "isSummon" in item && "isEvent" in item && (
              <p>
                <b>Classification:</b>
                {(item.inArena as boolean) && "Arena"}
                {(item.isSummon as boolean) && "Summon"}
                {(item.isEvent as boolean) && "Event"}
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
            {"staminaCostReducePerLvl" in item && item.staminaCostReducePerLvl > 0 && (
              <p className="col-span-2">
                <b>Stamina Usage Reduction Per Lvl</b>: {item.staminaCostReducePerLvl}
              </p>
            )}
            {"healthCostReducePerLvl" in item && item.healthCostReducePerLvl > 0 && (
              <p className="col-span-2">
                <b>Health Usage Reduction Per Lvl</b>: {item.healthCostReducePerLvl}
              </p>
            )}
          </div>
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
              <div className="grid grid-cols-2 col-span-2">
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

          {effects?.map((effect, i) => {
            // Get schema for parsing effect
            const schema = getTagSchema(effect.type);
            // Delete description, so that we get the default one
            if ("description" in effect) delete effect.description;
            const result = schema.safeParse(effect);
            const parsedEffect = result.success ? result.data : undefined;

            return (
              <div
                key={effect.type + i.toString()}
                className={`my-2 rounded-lg ${
                  parsedEffect ? "bg-poppopover" : "bg-red-100"
                } p-2`}
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
                      <b>Effect {i + 1}: </b> <i>{parsedEffect.description}</i>
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
                      {"power" in parsedEffect && (
                        <span>
                          <b>Effect Power: </b>
                          {parsedEffect.power}
                        </span>
                      )}
                      {"rank" in parsedEffect && (
                        <span>
                          <b>Rank: </b>
                          {parsedEffect.rank}
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
                      {"direction" in parsedEffect &&
                        parsedEffect.direction &&
                        (effect.type === "increasestat" ||
                          effect.type === "decreasestat") && (
                          <span>
                            <b>Direction: </b>
                            {parsedEffect.direction.toLowerCase()}
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
