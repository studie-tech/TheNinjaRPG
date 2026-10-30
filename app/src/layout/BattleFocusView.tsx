"use client";

import { Minimize2, Swords } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffectivePools } from "@/hooks/useEffectivePools";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import AvatarImage from "@/layout/Avatar";
import { VisualizeEffects } from "@/layout/MenuBoxProfile";
import StatusBar from "@/layout/StatusBar";
import type { BattleState, ReturnedUserState } from "@/libs/combat/types";
import { cn } from "@/libs/shadui";
import { useUserData } from "@/utils/UserContext";

/**
 * Full-window battle screen: the layout's header, sidebars and phone navigation
 * step aside so the battlefield, both teams, every action and the log fit on one
 * screen without scrolling. Rendered into the document body above the layout;
 * popovers, toasts and the tutorial still open on top of it.
 */
export function BattleFocusView({
  battle,
  controlledActorId,
  swapFocusPanels = false,
  timer,
  field,
  fieldRatio,
  dock,
  autoControl,
  log,
  timeline,
  onShowLayout,
}: BattleFocusViewProps) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [mounted, setMounted] = useState(false);

  // The page behind stays put while the battle covers it.
  useEffect(() => {
    setMounted(true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!mounted) return null;

  const me = battle?.usersState.find((user) => user.userId === controlledActorId);
  const fighters = (battle?.usersState ?? []).filter(
    (user) => !user.isSummon || user.userId === controlledActorId,
  );
  const allies = me ? fighters.filter((user) => user.direction === me.direction) : [];
  const enemies = me ? fighters.filter((user) => user.direction !== me.direction) : [];

  const exitButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-[32px] shrink-0 gap-[6px] px-[10px] text-[12px]"
      onClick={onShowLayout}
      title="Show the game layout around the battle"
    >
      <Minimize2 className="h-[14px] w-[14px]" aria-hidden />
      Show layout
    </Button>
  );

  const panels = (
    <Tabs defaultValue="log" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="grid w-full shrink-0 grid-cols-2">
        <TabsTrigger value="log" className="text-[12px]">
          Battle log
        </TabsTrigger>
        <TabsTrigger value="timeline" className="text-[12px]">
          Timeline
        </TabsTrigger>
      </TabsList>
      <TabsContent value="log" className="mt-[6px] min-h-0 flex-1 overflow-y-auto">
        {log}
      </TabsContent>
      <TabsContent value="timeline" className="mt-[6px] min-h-0 flex-1 overflow-y-auto">
        {timeline}
      </TabsContent>
    </Tabs>
  );

  const fieldBox = (
    // Size the battlefield to whichever runs out first: width or height.
    <div className="@container/field [container-type:size] flex min-h-0 flex-1 items-center justify-center">
      <div
        className={cn("w-full", fieldRatio === undefined && "h-full overflow-y-auto")}
        style={
          fieldRatio === undefined
            ? undefined
            : { width: `min(100cqw, calc(100cqh / ${fieldRatio}))` }
        }
      >
        {field}
      </div>
    </div>
  );

  const view = isDesktop ? (
    <div className="grid h-full grid-cols-[minmax(200px,250px)_minmax(0,1fr)_minmax(220px,290px)] gap-[10px] p-[10px]">
      <aside
        aria-label="Your side"
        className="flex min-h-0 flex-col gap-[8px] overflow-y-auto overscroll-contain"
      >
        {exitButton}
        {allies.map((user) => (
          <FighterCard
            key={user.userId}
            battle={battle}
            user={user}
            isPrimary={user.userId === controlledActorId}
          />
        ))}
        {autoControl}
      </aside>
      <main aria-label="Battle" className="flex min-h-0 min-w-0 flex-col gap-[8px]">
        <div className="shrink-0">{timer}</div>
        {fieldBox}
        <section
          aria-label={swapFocusPanels ? "Battle history" : "Battle actions"}
          className={cn(
            "min-h-0 shrink-0",
            swapFocusPanels
              ? "flex h-[30%] max-h-[240px] flex-col"
              : "max-h-[42%] overflow-y-auto overscroll-contain",
          )}
        >
          {swapFocusPanels ? panels : dock}
        </section>
      </main>
      <aside
        aria-label={
          swapFocusPanels ? "Opponents and actions" : "Opponents and battle log"
        }
        className="flex min-h-0 flex-col gap-[8px]"
      >
        <div className="flex max-h-[55%] shrink-0 flex-col gap-[8px] overflow-y-auto overscroll-contain">
          {enemies.map((user, index) => (
            <FighterCard
              key={user.userId}
              battle={battle}
              user={user}
              isPrimary={index === 0}
            />
          ))}
        </div>
        <section
          aria-label={swapFocusPanels ? "Battle actions" : "Battle history"}
          className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
        >
          {swapFocusPanels ? dock : panels}
        </section>
      </aside>
    </div>
  ) : (
    <div className="flex h-full flex-col gap-[6px] p-[6px]">
      <div className="flex shrink-0 items-center gap-[6px]">{exitButton}</div>
      <div className="shrink-0">{timer}</div>
      <div className="grid shrink-0 grid-cols-2 gap-[6px]">
        {me && <FighterCard battle={battle} user={me} compact />}
        {enemies[0] && (
          <FighterCard
            battle={battle}
            user={enemies[0]}
            compact
            extra={enemies.length > 1 ? enemies.length - 1 : 0}
          />
        )}
      </div>
      <div className="shrink-0">
        <div
          className={cn(fieldRatio === undefined && "max-h-[50dvh] overflow-y-auto")}
        >
          {field}
        </div>
      </div>
      <Tabs defaultValue="actions" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="grid w-full shrink-0 grid-cols-3">
          <TabsTrigger value="actions" className="gap-[4px] text-[12px]">
            <Swords className="h-[14px] w-[14px]" aria-hidden />
            Actions
          </TabsTrigger>
          <TabsTrigger value="log" className="text-[12px]">
            Log
          </TabsTrigger>
          <TabsTrigger value="timeline" className="text-[12px]">
            Timeline
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="actions"
          className="mt-[6px] min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {dock}
          {autoControl && <div className="mt-[6px]">{autoControl}</div>}
        </TabsContent>
        <TabsContent value="log" className="mt-[6px] min-h-0 flex-1 overflow-y-auto">
          {log}
        </TabsContent>
        <TabsContent
          value="timeline"
          className="mt-[6px] min-h-0 flex-1 overflow-y-auto"
        >
          {timeline}
        </TabsContent>
      </Tabs>
    </div>
  );

  return createPortal(
    <section
      aria-label="Battle"
      className="bg-background text-foreground fixed inset-0 z-50 h-dvh"
    >
      {view}
    </section>,
    document.body,
  );
}

/** One combatant: portrait, name, pools and (for main fighters) active effects. */
function FighterCard({
  battle,
  user,
  isPrimary,
  compact,
  extra = 0,
}: {
  battle: BattleState["battle"];
  user: ReturnedUserState;
  isPrimary?: boolean;
  compact?: boolean;
  extra?: number;
}) {
  const { timeDiff } = useUserData();
  const pools = useEffectivePools({
    battleUser: user,
    usersEffects: battle?.usersEffects,
  });
  const isOut = user.curHealth <= 0 || user.fledBattle || user.leftBattle;
  const bars = [
    {
      key: "hp",
      title: "HP",
      tooltip: "Health",
      color: "bg-red-500",
      cur: pools.curHealth,
      max: pools.maxHealth,
    },
    {
      key: "cp",
      title: "CP",
      tooltip: "Chakra",
      color: "bg-blue-500",
      cur: pools.curChakra,
      max: pools.maxChakra,
    },
    {
      key: "sp",
      title: "SP",
      tooltip: "Stamina",
      color: "bg-green-500",
      cur: pools.curStamina,
      max: pools.maxStamina,
    },
  ] as const;

  return (
    <section
      aria-label={user.username}
      className={cn(
        "bg-card text-card-foreground rounded-lg border p-[8px] shadow-sm",
        isOut && "opacity-50",
      )}
    >
      <div className="flex items-center gap-[8px]">
        <div className="h-[36px] w-[36px] shrink-0 overflow-hidden rounded-md">
          <AvatarImage
            href={user.avatar}
            userId={user.userId}
            alt={user.username}
            size={36}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold">
            {user.username}
            {extra > 0 && (
              <span className="text-muted-foreground ml-[4px] text-[11px] font-normal">
                +{extra} more
              </span>
            )}
          </p>
          {isOut && (
            <p className="text-muted-foreground truncate text-[11px]">
              {user.fledBattle
                ? "Fled"
                : user.leftBattle
                  ? "Left the battle"
                  : "Defeated"}
            </p>
          )}
        </div>
      </div>
      <div className="mt-[4px] text-[11px] [&_p]:text-[11px]">
        {bars
          .filter((bar) => !compact || bar.key !== "sp")
          .map((bar) => (
            <StatusBar
              key={`${bar.key}-${bar.cur}-${bar.max}`}
              title={bar.title}
              tooltip={bar.tooltip}
              color={bar.color}
              showText={true}
              lastRegenAt={user.regenAt}
              regen={0}
              status={"AWAKE"}
              current={bar.cur}
              total={bar.max}
              timeDiff={timeDiff}
            />
          ))}
      </div>
      {isPrimary && !compact && battle?.usersEffects && (
        <div className="mt-[6px] text-[12px]">
          <VisualizeEffects
            effects={battle.usersEffects}
            userId={user.userId}
            diffuseDamage={user.diffuseDamage}
          />
        </div>
      )}
    </section>
  );
}

interface BattleFocusViewProps {
  battle: BattleState["battle"];
  controlledActorId?: string;
  /** Desktop preference: history below the field and actions below the opponents. */
  swapFocusPanels?: boolean;
  timer: ReactNode;
  field: ReactNode;
  /** Height per width of the battlefield; undefined while results replace it. */
  fieldRatio?: number;
  dock: ReactNode;
  autoControl?: ReactNode;
  log: ReactNode;
  timeline: ReactNode;
  onShowLayout: () => void;
}
