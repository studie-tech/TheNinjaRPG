import React from "react";
import ContentImage from "./ContentImage";
import DurabilityBar from "@/layout/DurabilityBar";
import { useUserData } from "@/utils/UserContext";
import { Info, HelpCircle, Star } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import ItemWithEffects from "@/layout/ItemWithEffects";
import ElementImage from "@/layout/ElementImage";
import { canChangeContent } from "@/utils/permissions";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "src/libs/shadui";
import { type ItemRarity } from "@/drizzle/schema";
import type { Item, Jutsu, Bloodline } from "@/drizzle/schema";
import type { ZodAllTags } from "@/libs/combat/types";

interface ActionItemProps {
  id: string;
  name: string;
  image: string;
  warning?: string;
  rarity?: ItemRarity;
  type?: "jutsu" | "item" | "basic" | "village" | "asset" | "bloodline";
  effects?: ZodAllTags[];
  highlight?: boolean;
  isFavorite?: boolean;
  hidden?: boolean | number;
  cooldown?: number;
  frames?: number;
  speed?: number;
  lastUsedRound?: number;
  durability?: number;
  maxDurability?: number;
}

interface ActionSelectorSettingsProps {
  className?: string;
  aspectRatioClass?: string;
  gridClassNameOverwrite?: string;
  currentRound?: number;
  roundFull?: boolean;
  hideBorder?: boolean;
  showBgColor?: boolean;
  showLabels: boolean;
  selectedId?: string;
  greyedIds?: string[];
  labelSingles?: boolean;
  onClick: (id: string) => void;
  emptyText?: string;
  lastElement?: HTMLDivElement | null;
  setLastElement?: (el: HTMLDivElement | null) => void;
  showInfoIcon?: boolean;
  combatMode?: boolean;
}

interface ActionSelectorProps extends ActionSelectorSettingsProps {
  items?: ActionItemProps[] | null;
  counts?:
    | {
        id: string;
        quantity: number;
      }[]
    | null;
  renderItem?: (
    item: NonNullable<ActionSelectorProps["items"]>[number],
  ) => React.ReactNode;
}

export const ActionSelector: React.FC<ActionSelectorProps> = (props) => {
  const { data: userData } = useUserData();
  const { items, counts, renderItem, ...settings } = props;
  const filtered = items?.filter(
    (i) => !i.hidden || (userData && canChangeContent(userData.role)),
  );
  const base = "gap-1 text-xs";
  const grid = props.gridClassNameOverwrite || "grid grid-cols-6 md:grid-cols-7";
  const bgColor = props.showBgColor
    ? "border-b-2 border-l-2 border-r-2 bg-slate-50 text-black"
    : "";
  return (
    <>
      <div className={cn(base, grid, bgColor, props.className)}>
        {filtered?.map((item, i) => {
          let bgColor = "";
          if (item.type === "jutsu") {
            bgColor = "bg-blue-100";
          } else if (item.type === "item") {
            if ("itemType" in item) {
              if (item.itemType === "WEAPON") {
                bgColor = "bg-red-200";
              } else if (item.itemType === "CONSUMABLE") {
                bgColor = "bg-green-200";
              } else {
                bgColor = "bg-purple-200";
              }
            } else {
              bgColor = "bg-purple-100";
            }
          } else if (item.type === "basic") {
            bgColor = "bg-orange-200";
          }
          const isGreyed =
            (props.selectedId !== undefined && props.selectedId !== item.id) ||
            (props.greyedIds?.includes(item.id) ?? false);
          const isHighlight = item.highlight ?? false;

          return (
            <div
              key={i}
              ref={i === filtered.length - 1 ? props.setLastElement : null}
              className="relative flex items-start justify-center"
            >
              <div className="relative h-full w-full">
                {renderItem ? (
                  renderItem(item)
                ) : (
                  <ActionOption
                    item={item}
                    settings={settings}
                    className={cn(
                      "h-full",
                      isHighlight
                        ? "rounded-xl border-4 border-amber-500 bg-amber-300 text-black"
                        : "",
                      bgColor,
                      isGreyed ? "opacity-20" : "",
                    )}
                    isGreyed={isGreyed}
                    count={counts?.find((c) => c.id === item.id)?.quantity}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {items?.length === 0 && (
        <span className="flex flex-row text-base">
          {props.emptyText ? props.emptyText : "Nothing Available"}
        </span>
      )}
    </>
  );
};

interface ActionOptionProps {
  item: ActionItemProps;
  settings: ActionSelectorSettingsProps;
  className?: string;
  count?: number;
  isGreyed: boolean;
}

export const ActionOption: React.FC<ActionOptionProps> = (props) => {
  const { item, settings } = props;
  const { cooldown, image, name, rarity, frames, speed, lastUsedRound, warning } = item;

  // Derived values
  const cooldownPerc = Math.max(
    cooldown && settings.currentRound && lastUsedRound
      ? 100 - (100 * (settings.currentRound - lastUsedRound)) / cooldown
      : 0,
    0,
  );
  const elements = item.effects
    ? item.effects.flatMap((e) => ("elements" in e && e.elements ? e.elements : []))
    : [];

  // Render
  return (
    <div
      className={cn(
        "relative text-center flex cursor-pointer flex-col items-center justify-start",
        settings.combatMode ? "text-black" : "text-foreground",
        props.isGreyed ? "hover:opacity-80" : "hover:opacity-90",
        props.className,
      )}
    >
      <div className="relative w-full">
        <ContentImage
          image={image}
          alt={name}
          rarity={rarity}
          className={cn(settings.aspectRatioClass)}
          roundFull={settings.roundFull}
          hideBorder={settings.hideBorder}
          frames={frames}
          speed={speed}
          onClick={() => {
            settings.onClick(item.id);
          }}
        />
        {/* Count overlay - bottom right corner */}
        {props.count !== undefined && (settings.labelSingles || props.count > 1) && (
          <div className="absolute bottom-0 right-0 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-amber-300 bg-slate-300 text-black text-base font-bold">
            {props.count}
          </div>
        )}
        {/* Warning icon - top right corner */}
        {warning !== undefined && warning && (
          <div className="absolute top-0 right-0">
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-7 w-7 cursor-pointer hover:text-orange-500 fill-red-600 text-white" />
                </TooltipTrigger>
                <TooltipContent>{warning}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        {/* Cooldown pie overlay */}
        {cooldownPerc > 0 && (
          <>
            <div
              className="absolute top-0 right-0 left-0 bottom-0 opacity-90 hover:cursor-not-allowed"
              style={{
                background: `conic-gradient(#ededed ${cooldownPerc}%, rgba(0, 0, 0, 0.1) 0deg)`,
              }}
            ></div>
            {cooldown &&
              settings.currentRound &&
              lastUsedRound &&
              cooldown - (settings.currentRound - lastUsedRound) > 0 && (
                <div className="absolute bottom-0 left-0 right-0 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-slate-400 bg-slate-300 text-black text-base font-bold z-10">
                  {cooldown - (settings.currentRound - lastUsedRound)}
                </div>
              )}
          </>
        )}
        {/* Help / info icon - bottom left corner */}
        {settings.showInfoIcon && (
          <Popover>
            <PopoverTrigger
              className="absolute bottom-1 left-1 z-10"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <HelpCircle className="h-5 w-5 cursor-pointer text-white hover:text-orange-500" />
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-2">
              {item.type === "jutsu" ||
              item.type === "item" ||
              item.type === "bloodline" ||
              item.type === "basic" ? (
                <ItemWithEffects item={item as Item | Jutsu | Bloodline} hideImage />
              ) : (
                <div className="flex flex-col gap-2 text-sm">
                  <span className="font-semibold">{item.name}</span>
                  {item.effects && item.effects.length > 0 && (
                    <div className="flex flex-col gap-1">
                      {item.effects.map((e, idx) => (
                        <span key={idx}>
                          Effect {idx + 1}: {e.type}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}
        {/* Elements overlay */}
        {elements.map((element, i) => (
          <div
            key={i}
            className={`absolute top-[-5px]`}
            style={{ left: `${i * 10}px` }}
          >
            <ElementImage element={element} className="w-6" />
          </div>
        ))}
        {/* Durability bar */}
        {item.durability !== undefined &&
          item.maxDurability !== undefined &&
          item.maxDurability > 0 && (
            <DurabilityBar
              currentDurability={item.durability}
              maxDurability={item.maxDurability}
              position="top-left"
              size="medium"
            />
          )}
        {/* Favorite indicator - top right corner */}
        {item.isFavorite && (
          <div className="absolute top-[-5px] right-[-5px]">
            <Star className="h-5 w-5 fill-yellow-400 text-yellow-400" />
          </div>
        )}
      </div>
      {settings.showLabels ? name : ""}
    </div>
  );
};
