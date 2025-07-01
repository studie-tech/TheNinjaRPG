import React from "react";
import ContentImage from "./ContentImage";
import { useUserData } from "@/utils/UserContext";
import { Info } from "lucide-react";
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
import type { ZodAllTags } from "@/libs/combat/types";

interface ActionSelectorProps {
  className?: string;
  aspectRatioClass?: string;
  gridClassNameOverwrite?: string;
  items?:
    | {
        id: string;
        name: string;
        image: string;
        warning?: string;
        rarity?: ItemRarity;
        type?: "jutsu" | "item" | "basic" | "village" | "asset";
        effects?: ZodAllTags[];
        highlight?: boolean;
        hidden?: boolean | number;
        cooldown?: number;
        frames?: number;
        speed?: number;
        lastUsedRound?: number;
      }[]
    | null;
  counts?:
    | {
        id: string;
        quantity: number;
      }[]
    | null;
  currentRound?: number;
  roundFull?: boolean;
  hideBorder?: boolean;
  showBgColor: boolean;
  showLabels: boolean;
  selectedId?: string;
  greyedIds?: string[];
  labelSingles?: boolean;
  onClick: (id: string) => void;
  emptyText?: string;
  lastElement?: HTMLDivElement | null;
  setLastElement?: (el: HTMLDivElement | null) => void;
  /** Optional custom renderer for each item */
  renderItem?: (
    item: NonNullable<ActionSelectorProps["items"]>[number],
  ) => React.ReactNode;
}

export const ActionSelector: React.FC<ActionSelectorProps> = (props) => {
  const { data: userData } = useUserData();
  const filtered = props.items?.filter(
    (i) => !i.hidden || (userData && canChangeContent(userData.role)),
  );
  const base = "gap-1 text-xs";
  const grid = props.gridClassNameOverwrite || "grid grid-cols-6 md:grid-cols-8";
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
          const elements = item.effects
            ? item.effects.flatMap((e) =>
                "elements" in e && e.elements ? e.elements : [],
              )
            : [];

          return (
            <div
              key={i}
              ref={i === filtered.length - 1 ? props.setLastElement : null}
              className="relative"
            >
              {props.renderItem ? (
                props.renderItem(item)
              ) : (
                <ActionOption
                  aspectRatioClass={props.aspectRatioClass}
                  className={cn(
                    "h-full",
                    isHighlight
                      ? "rounded-xl border-4 border-amber-500 bg-amber-300 text-black"
                      : "",
                    bgColor,
                    isGreyed ? "opacity-20" : "",
                  )}
                  src={item.image}
                  isGreyed={isGreyed}
                  alt={item.name}
                  warning={item?.warning}
                  roundFull={props.roundFull}
                  hideBorder={props.hideBorder}
                  rarity={item.rarity}
                  cooldown={item.cooldown}
                  frames={item.frames}
                  speed={item.speed}
                  lastUsedRound={item.lastUsedRound}
                  currentRound={props.currentRound}
                  txt={props.showLabels ? item.name : ""}
                  count={props.counts?.find((c) => c.id === item.id)?.quantity}
                  labelSingles={props.labelSingles}
                  onClick={() => {
                    props.onClick(item.id);
                  }}
                />
              )}
              {elements.map((element, i) => (
                <div
                  key={i}
                  className={`absolute top-[-5px]`}
                  style={{ left: `${i * 10}px` }}
                >
                  <ElementImage element={element} className="w-6" />
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {props.items?.length === 0 && (
        <span className="flex flex-row text-base">
          {props.emptyText ? props.emptyText : "Nothing Available"}
        </span>
      )}
    </>
  );
};

interface ActionOptionProps {
  src: string;
  alt: string;
  txt: string;
  warning?: string;
  rarity?: ItemRarity;
  count?: number;
  frames?: number;
  speed?: number;
  isGreyed: boolean;
  className?: string;
  roundFull?: boolean;
  hideBorder?: boolean;
  labelSingles?: boolean;
  cooldown?: number;
  currentRound?: number;
  lastUsedRound?: number;
  aspectRatioClass?: string;
  onClick?: () => void;
}

export const ActionOption: React.FC<ActionOptionProps> = (props) => {
  const { cooldown, currentRound, lastUsedRound } = props;
  const cooldownPerc = Math.max(
    cooldown && currentRound && lastUsedRound
      ? 100 - (100 * (currentRound - lastUsedRound)) / cooldown
      : 0,
    0,
  );
  return (
    <div
      className={cn(
        "relative text-center flex cursor-pointer flex-col items-center justify-start",
        props.isGreyed ? "hover:opacity-80" : "hover:opacity-90",
        props.className,
      )}
    >
      <div className="relative w-full">
        <ContentImage
          image={props.src}
          alt={props.alt}
          rarity={props.rarity}
          className={cn(props.aspectRatioClass)}
          roundFull={props.roundFull}
          hideBorder={props.hideBorder}
          frames={props.frames}
          speed={props.speed}
          onClick={props.onClick}
        />
        {props.count !== undefined && (props.labelSingles || props.count > 1) && (
          <div className="absolute bottom-0 right-0 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-amber-300 bg-slate-300 text-black text-base font-bold">
            {props.count}
          </div>
        )}
        {props.warning !== undefined && props.warning && (
          <div className="absolute top-0 right-0">
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-7 w-7 cursor-pointer hover:text-orange-500 fill-red-600 text-white" />
                </TooltipTrigger>
                <TooltipContent>{props.warning}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        {cooldownPerc > 0 && (
          <>
            <div
              className="absolute top-0 right-0 left-0 bottom-0 opacity-90 hover:cursor-not-allowed"
              style={{
                background: `conic-gradient(#ededed ${cooldownPerc}%, rgba(0, 0, 0, 0.1) 0deg)`,
              }}
            ></div>
            {cooldown &&
              currentRound &&
              lastUsedRound &&
              cooldown - (currentRound - lastUsedRound) > 0 && (
                <div className="absolute bottom-0 left-0 right-0 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-slate-400 bg-slate-300 text-black text-base font-bold z-10">
                  {cooldown - (currentRound - lastUsedRound)}
                </div>
              )}
          </>
        )}
      </div>
      {props.txt}
    </div>
  );
};
