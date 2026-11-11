import { HelpCircle, Info, Palette, Star, Zap } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { GameAssetType } from "@/drizzle/constants";
import { SAGE_MODE_ACTIVATION_JUTSU_ID } from "@/drizzle/constants";
import type { Bloodline, Item, ItemRarity, Jutsu } from "@/drizzle/schema";
import ContentImage from "@/layout/ContentImage";
import DurabilityBar from "@/layout/DurabilityBar";
import ElementImage from "@/layout/ElementImage";
import ItemWithEffects from "@/layout/ItemWithEffects";
import { getActionPointCost, getRemainingCooldown } from "@/libs/combat/actions";
import { canSetHotkeys } from "@/libs/combat/hotkeys";
import type { CombatAction, ReturnedBattle } from "@/libs/combat/types";
import { isActionRangeLimited } from "@/libs/hexgrid";
import { cn } from "@/libs/shadui";
import { canChangeContent } from "@/utils/permissions";
import { useUserData } from "@/utils/UserContext";
import type { ZodAllTags } from "@/validators/combat";

interface ActionItemProps
  extends Partial<
    Pick<CombatAction, "target" | "range" | "method" | "coordinateTargeting">
  > {
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
  isReskinned?: boolean;
  assetType?: GameAssetType;
  url?: string;
  actionCostPerc?: number;
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
  /** Hides `emptyText` while the items are still loading. */
  isLoading?: boolean;
  setLastElement?: (el: HTMLDivElement | null) => void;
  showInfoIcon?: boolean;
  /**
   * Load every tile's art immediately. Only the combat action bar sets it: it is on screen the
   * moment combat opens and holds a handful of actions, unlike the catalogs which are long and
   * mostly below the fold.
   */
  eagerImages?: boolean;
  combatMode?: boolean;
  /** Usable AP after combat effects such as stun. */
  userActionPoints?: number;
  battle?: ReturnedBattle | null;
  userId?: string;
  /** Battle key per action id, shown as a badge on the tile. */
  hotkeys?: Record<string, string>;
  /** Right-click on a tile opens key assignment when a fine pointer is available. */
  onAssignHotkey?: (item: ActionItemProps) => void;
}

interface ActionSelectorProps extends ActionSelectorSettingsProps {
  items?: ActionItemProps[] | null;
  counts?:
    | {
        id: string;
        quantity: number;
      }[]
    | null;
  /** Ownership levels (e.g. item mastery) — rendered bottom-left with a red border. */
  levels?:
    | {
        id: string;
        level: number;
      }[]
    | null;
  renderItem?: (
    item: NonNullable<ActionSelectorProps["items"]>[number],
  ) => React.ReactNode;
}

export const ActionSelector: React.FC<ActionSelectorProps> = (props) => {
  const { data: userData } = useUserData();
  const { items, counts, levels, renderItem, ...settings } = props;
  const { combatMode, selectedId, currentRound, userActionPoints, onClick } = props;
  const filtered = items?.filter(
    (i) => !i.hidden || (userData && canChangeContent(userData.role)),
  );
  const base = "gap-1 text-xs";
  const grid = props.gridClassNameOverwrite || "grid grid-cols-6 md:grid-cols-7";
  const bgColor = props.showBgColor
    ? "rounded-lg border bg-card text-card-foreground"
    : "";

  // Track previous round to detect round changes
  const prevRoundRef = useRef<number | undefined>(currentRound);

  // Auto-deselect action in combat mode when round changes (except basic actions)
  useEffect(() => {
    if (!combatMode || currentRound === undefined) return;
    if (prevRoundRef.current !== undefined && prevRoundRef.current !== currentRound) {
      if (selectedId) {
        // Don't deselect basic actions
        const selectedItem = filtered?.find((i) => i.id === selectedId);
        if (selectedItem?.type !== "basic") {
          onClick(selectedId);
        }
      }
    }
    prevRoundRef.current = currentRound;
  }, [combatMode, currentRound, selectedId, onClick, filtered]);

  // Auto-deselect action in combat mode if it can't be repeated
  useEffect(() => {
    if (!combatMode || !selectedId || !filtered) return;
    const selectedItem = filtered.find((i) => i.id === selectedId);
    if (!selectedItem) return;

    if (
      getRemainingCooldown(selectedItem, currentRound) > 0 ||
      lacksActionPoints(getEffectiveActionCost(selectedItem, props), {
        combatMode,
        userActionPoints,
      })
    ) {
      onClick(selectedId);
    }
  }, [
    combatMode,
    selectedId,
    currentRound,
    userActionPoints,
    onClick,
    filtered,
    props.battle,
    props.userId,
  ]);

  return (
    <>
      <div className={cn(base, grid, bgColor, props.className)}>
        {filtered?.map((item, i) => {
          let bgColor = "";
          if (item.id === SAGE_MODE_ACTIVATION_JUTSU_ID) {
            bgColor = "bg-orange-200";
          } else if (item.type === "jutsu") {
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
            // biome-ignore lint/a11y/noStaticElementInteractions: right-click is a shortcut; keys can also be set on the jutsu and items pages.
            <div
              id={`tutorial-combat-action-${item.id}`}
              key={item.id}
              ref={i === filtered.length - 1 ? props.setLastElement : null}
              className="relative flex items-start justify-center"
              onContextMenu={
                props.onAssignHotkey
                  ? (event) => {
                      // A long press on a touch screen also opens the context menu.
                      if (!canSetHotkeys(event)) return;
                      event.preventDefault();
                      props.onAssignHotkey?.(item);
                    }
                  : undefined
              }
            >
              <div className="relative h-full w-full">
                {props.hotkeys?.[item.id] && (
                  <kbd
                    title={`Hotkey ${(props.hotkeys[item.id] ?? "").toUpperCase()}`}
                    className="pointer-events-none absolute top-[2px] left-[2px] z-10 min-w-[16px] not-any-pointer-fine:hidden rounded-[3px] border border-black/40 bg-white/90 px-[3px] text-center font-bold font-mono text-[10px] text-black leading-[14px] shadow-sm"
                  >
                    {(props.hotkeys[item.id] ?? "").toUpperCase()}
                  </kbd>
                )}
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
                    level={levels?.find((l) => l.id === item.id)?.level}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {items?.length === 0 && (
        // Doubles as the pagination sentinel: a batch that was filtered down to nothing
        // can still have more batches behind it.
        <div ref={props.setLastElement} className="flex flex-row text-base">
          {!props.isLoading &&
            (props.emptyText ? props.emptyText : "Nothing Available")}
        </div>
      )}
    </>
  );
};

interface ActionOptionProps {
  item: ActionItemProps;
  settings: ActionSelectorSettingsProps;
  className?: string;
  count?: number;
  level?: number;
  isGreyed: boolean;
}

export const ActionOption: React.FC<ActionOptionProps> = (props) => {
  const { item, settings } = props;
  const { cooldown, image, name, rarity, frames, speed, warning, isReskinned } = item;

  // Derived values
  const remainingCooldown = getRemainingCooldown(item, settings.currentRound);
  const cooldownPerc = cooldown ? (100 * remainingCooldown) / cooldown : 0;
  const elements = [
    ...new Set(
      item.effects?.flatMap((e) => ("elements" in e && e.elements ? e.elements : [])),
    ),
  ];
  const effectiveActionCost = getEffectiveActionCost(item, settings);
  const insufficientAP = lacksActionPoints(effectiveActionCost, settings);

  // Keep unavailable actions unselectable for both pointer and keyboard activation.
  const handleClick = () => {
    if (insufficientAP || (settings.combatMode && cooldownPerc > 0)) return;
    settings.onClick(item.id);
  };

  const art = (
    <ContentImage
      image={image}
      alt={name}
      rarity={rarity}
      className={cn(settings.aspectRatioClass)}
      roundFull={settings.roundFull}
      hideBorder={settings.hideBorder}
      frames={frames}
      speed={speed}
      eager={settings.eagerImages}
      onClick={settings.combatMode ? undefined : handleClick}
    />
  );

  // Render
  return (
    <div
      className={cn(
        "relative z-0 flex flex-col items-center justify-start rounded-md text-center",
        insufficientAP ? "cursor-not-allowed" : "cursor-pointer",
        props.isGreyed ? "hover:opacity-80" : insufficientAP ? "" : "hover:opacity-90",
        props.className,
      )}
    >
      <div className="relative w-full">
        {item.assetType === "SFX" && item.url ? (
          // biome-ignore lint/a11y/useKeyWithClickEvents: Container click is supplementary - audio controls are the primary interaction
          // biome-ignore lint/a11y/noStaticElementInteractions: Click handler supplements audio controls
          <div className={cn(settings.aspectRatioClass)} onClick={handleClick}>
            <div className="relative flex aspect-square w-full items-center justify-center rounded-xl border-2 bg-muted">
              {/* biome-ignore lint/a11y/useMediaCaption: Audio assets are sound effects without caption content */}
              <audio
                src={item.url}
                controls
                className="w-[85%]"
                onClick={(e) => {
                  e.stopPropagation();
                }}
              />
            </div>
          </div>
        ) : settings.combatMode ? (
          // Hover and keyboard focus describe the action; the help icon keeps the full details.
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="block w-full rounded-xl focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed"
                  aria-label={name}
                  aria-disabled={insufficientAP || cooldownPerc > 0}
                  aria-pressed={settings.selectedId === item.id}
                  onClick={handleClick}
                >
                  {art}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-60 text-left">
                <p className="font-bold">{name}</p>
                <p>{actionHoverSummary(item, effectiveActionCost)}</p>
                {cooldownPerc > 0 && <p>On cooldown</p>}
                {insufficientAP && <p>Not enough AP</p>}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          art
        )}
        {/* Count overlay - bottom right corner (amber = stack / jutsu quantity) */}
        {props.count !== undefined && (settings.labelSingles || props.count > 1) && (
          <div className="absolute right-0 bottom-0 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-amber-300 bg-slate-300 font-bold text-base text-black">
            {props.count}
          </div>
        )}
        {/* Level overlay - bottom left corner (red border = ownership level) */}
        {props.level !== undefined && (
          <div className="absolute bottom-0 left-0 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-red-600 bg-slate-300 font-bold text-base text-black">
            {props.level}
          </div>
        )}
        {/* Warning icon - top right corner */}
        {warning !== undefined && warning && (
          <div className="absolute top-0 right-0">
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-7 w-7 cursor-pointer fill-red-600 text-white hover:text-orange-500" />
                </TooltipTrigger>
                <TooltipContent>{warning}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        {/* Reskin indicator - bottom centre */}
        {isReskinned && (
          <div className="absolute right-1/2 bottom-0 translate-x-1/2">
            <TooltipProvider delayDuration={50}>
              <Tooltip>
                <TooltipTrigger>
                  <Palette className="h-7 w-7 cursor-pointer text-white hover:text-orange-500" />
                </TooltipTrigger>
                <TooltipContent>Reskinned</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        {/* Cooldown pie overlay */}
        {cooldownPerc > 0 && (
          <>
            <div
              className="pointer-events-none absolute top-0 right-0 bottom-0 left-0 opacity-90"
              style={{
                background: `conic-gradient(#ededed ${cooldownPerc}%, rgba(0, 0, 0, 0.1) 0deg)`,
              }}
            ></div>
            <div className="pointer-events-none absolute right-0 bottom-0 left-0 z-10 flex h-7 w-7 flex-row items-center justify-center rounded-full border-2 border-slate-400 bg-slate-300 font-bold text-base text-black">
              {remainingCooldown}
            </div>
          </>
        )}
        {/* Insufficient AP overlay */}
        {insufficientAP && cooldownPerc === 0 && (
          <div className="pointer-events-none absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center rounded-md bg-slate-800/70">
            <Zap className="h-8 w-8 text-red-500" />
          </div>
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
                        <span key={e.type}>
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
        {/* Elements overlay - a row inset from the top left corner */}
        {elements.length > 0 && (
          <div className="pointer-events-none absolute top-0.5 left-0.5 flex max-w-[calc(100%-0.25rem)] flex-row flex-wrap gap-px">
            {elements.map((element) => (
              <ElementImage key={element} element={element} className="w-5" />
            ))}
          </div>
        )}
        {/* Durability bar */}
        {item.durability !== undefined && item.maxDurability !== undefined && (
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
      {settings.showLabels && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: pointer shortcut for the action control above, which handles keyboard selection
        // biome-ignore lint/a11y/noStaticElementInteractions: a span avoids nesting buttons in catalogs that wrap the tile
        <span className="w-full break-words" onClick={handleClick}>
          {name}
        </span>
      )}
    </div>
  );
};

/** One line on what a battle action is aimed at and what it costs, e.g. "Target: other user · Range 4 · 60 AP". */
const actionHoverSummary = (item: ActionItemProps, actionCost: number | undefined) => {
  const { target, range } = item;
  return [
    target && `Target: ${target.toLowerCase().replaceAll("_", " ")}`,
    range !== undefined &&
      target !== "SELF" &&
      isActionRangeLimited(item) &&
      `Range ${range}`,
    actionCost !== undefined && `${actionCost} AP`,
  ]
    .filter(Boolean)
    .join(" · ");
};

/** An action's AP cost: its effective cost in combat, otherwise its listed cost. */
const getEffectiveActionCost = (
  item: ActionItemProps,
  settings: ActionCostSettings,
) => {
  const { combatMode, battle, userId } = settings;
  return combatMode && battle && userId
    ? getActionPointCost(userId, battle, item as CombatAction)
    : item.actionCostPerc;
};

/**
 * Check combat affordability using the resolved cost also shown on the action card.
 * Unknown AP or cost leaves this UI-only guard inactive.
 */
const lacksActionPoints = (
  cost: number | undefined,
  settings: Pick<ActionSelectorSettingsProps, "combatMode" | "userActionPoints">,
) => {
  return (
    !!settings.combatMode &&
    settings.userActionPoints !== undefined &&
    cost !== undefined &&
    settings.userActionPoints < cost
  );
};

type ActionCostSettings = Pick<
  ActionSelectorSettingsProps,
  "combatMode" | "battle" | "userId"
>;
