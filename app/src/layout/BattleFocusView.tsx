"use client";

import { Minimize2, Swords } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEffectivePools } from "@/hooks/useEffectivePools";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import AvatarImage from "@/layout/Avatar";
import { BattleUserTraits } from "@/layout/BattleUserTraits";
import StatusBar from "@/layout/StatusBar";
import { VisualizeEffects } from "@/layout/VisualizeEffects";
import type { BattleState, ReturnedUserState } from "@/libs/combat/types";
import { cn } from "@/libs/shadui";
import { useUserData } from "@/utils/UserContext";

/**
 * Inset battle dialog with fighters, actions and history above the game layout.
 * Desktop panels fit the viewport; phones scroll when the field and usable action
 * space need more height. Non-modal Radix behavior keeps the external chat and
 * tutorial portals usable; covered layout branches remain inert.
 * Raised layout siblings opt into keyboard access with data-battle-focus-layer.
 */
export function BattleFocusView({
  battle,
  controlledActorId,
  swapFocusPanels = false,
  renderTimer,
  field,
  fieldRatio,
  dock,
  autoControl,
  log,
  timeline,
  onShowLayout,
}: BattleFocusViewProps) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [viewElement, setViewElement] = useState<HTMLDivElement | null>(null);
  const exitButtonRef = useRef<HTMLButtonElement>(null);

  // The page behind stays put while the battle covers it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    if (!viewElement) return;
    const covered = new Set<HTMLElement>();
    const restore = () => {
      for (const element of covered) element.removeAttribute("inert");
      covered.clear();
    };

    // A modal focus trap would exclude the visible chat and tutorial siblings.
    // Inert only covered branches, keeping Radix portals and live feedback usable.
    // This stays separate from Radix's aria-hidden bookkeeping so dialog cleanup
    // cannot retain an inert attribute on the layout.
    const isolateBattle = () => {
      restore();
      const layers = new Set<Element>([
        viewElement,
        ...document.body.querySelectorAll(
          "[data-battle-focus-layer], body > [data-state], [data-radix-popper-content-wrapper], [data-sonner-toaster]",
        ),
      ]);
      const ancestors = new Set<Element>();
      for (const layer of layers) {
        for (let parent = layer.parentElement; parent; parent = parent.parentElement) {
          ancestors.add(parent);
        }
      }
      const cover = (parent: Element) => {
        for (const child of parent.children) {
          if (layers.has(child)) continue;
          if (ancestors.has(child)) cover(child);
          else if (child instanceof HTMLElement && !child.hasAttribute("inert")) {
            child.setAttribute("inert", "");
            covered.add(child);
          }
        }
      };
      cover(document.body);
    };

    isolateBattle();
    exitButtonRef.current?.focus({ preventScroll: true });
    const observer = new MutationObserver(isolateBattle);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-battle-focus-layer"],
    });
    return () => {
      observer.disconnect();
      restore();
    };
  }, [viewElement]);

  const me = battle?.usersState.find((user) => user.userId === controlledActorId);
  const fighters = (battle?.usersState ?? []).filter(
    (user) => !user.isSummon || user.userId === controlledActorId,
  );
  const allies = me ? fighters.filter((user) => user.direction === me.direction) : [];
  const enemies = me ? fighters.filter((user) => user.direction !== me.direction) : [];

  const exitButton = (
    <Button
      ref={exitButtonRef}
      type="button"
      variant="outline"
      size="icon"
      className="h-10 w-10"
      aria-label="Show layout"
      onClick={onShowLayout}
      title="Show the game layout around the battle"
    >
      <Minimize2 className="h-5 w-5" aria-hidden />
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
    // Size the battlefield to whichever runs out first: width or height. The box itself is as
    // tall as the field at full width and shrinks on short screens, so the actions follow the
    // field directly instead of after a band of spare height.
    <div
      className={cn(
        "@container/field [container-type:size] flex min-h-0 items-start justify-center",
        fieldRatio === undefined ? "flex-1" : "shrink grow-0",
      )}
      style={
        fieldRatio === undefined
          ? undefined
          : { flexBasis: `calc(100cqw * ${fieldRatio})` }
      }
    >
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
      <main
        aria-label="Battle"
        className="@container/battle [container-type:inline-size] flex min-h-0 min-w-0 flex-col gap-[8px]"
      >
        <div className="shrink-0">{renderTimer(exitButton)}</div>
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
    <div className="flex h-full flex-col gap-[6px] overflow-y-auto overscroll-contain p-[6px]">
      <div className="shrink-0">{renderTimer(exitButton)}</div>
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
      {/* Limit the field's height without distorting its grid on short screens. */}
      <div className="shrink-0">
        <div
          className={cn(
            "mx-auto w-full",
            fieldRatio === undefined && "max-h-[50dvh] overflow-y-auto",
          )}
          style={
            fieldRatio === undefined
              ? undefined
              : { maxWidth: `calc(50dvh / ${fieldRatio})` }
          }
        >
          {field}
        </div>
      </div>
      <Tabs
        defaultValue="actions"
        className="flex min-h-[12rem] flex-1 shrink-0 flex-col"
      >
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

  return (
    <Dialog open modal={false} onOpenChange={(open) => !open && onShowLayout()}>
      <DialogPortal>
        {/* Radix omits its backdrop for non-modal roots. */}
        <div
          data-battle-focus-layer
          data-battle-focus-backdrop
          aria-hidden="true"
          className="fixed inset-0 z-50 bg-black/60"
        />
      </DialogPortal>
      <DialogContent
        ref={setViewElement}
        data-battle-focus-dialog
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex h-[99%] min-w-[99%] flex-col gap-0 overflow-hidden rounded-lg p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          // Only the backdrop dismisses; chat, toasts and tutorials keep the battle open.
          if (
            !(event.target instanceof Element) ||
            !event.target.closest("[data-battle-focus-backdrop]")
          ) {
            event.preventDefault();
          }
        }}
      >
        <DialogTitle className="sr-only">Battle focus</DialogTitle>
        <section aria-label="Battle" className="min-h-0 flex-1">
          {view}
        </section>
      </DialogContent>
    </Dialog>
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
          <AvatarImage href={user.avatar} alt={user.username} size={36} />
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
      {battle && (
        <BattleUserTraits
          battle={battle}
          battleUser={user}
          className="mt-[4px] text-[11px]"
          iconClassName="mr-[4px] h-[14px] w-[14px]"
        />
      )}
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
  /** Places the focus exit beside the timer's other controls. */
  renderTimer: (exitButton: ReactNode) => ReactNode;
  field: ReactNode;
  /** Height per width of the battlefield; undefined while results replace it. */
  fieldRatio?: number;
  dock: ReactNode;
  autoControl?: ReactNode;
  log: ReactNode;
  timeline: ReactNode;
  onShowLayout: () => void;
}
