"use client";

import { Bot, SlidersHorizontal } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useAutoCombatSetting } from "@/hooks/combat";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Link from "@/layout/Link";

interface BattleSetupPanelProps {
  /** Offer the auto combat switch. */
  autoCombat?: boolean;
  /** Mode-specific options shown under the loadouts. */
  children?: React.ReactNode;
  /** The mode's primary button. */
  action: React.ReactNode;
}

/**
 * Loadouts, auto combat and the primary action for a fight. A rail beside the mode on wide
 * screens; on narrow ones the controls move into a sheet and the action stays in view.
 */
export function BattleSetupPanel({
  autoCombat,
  children,
  action,
}: BattleSetupPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAutoCombat] = useAutoCombatSetting();
  return (
    <aside
      aria-label="Battle setup"
      // On phones the action stays in view, held clear of the tallest layout navigation bar.
      className="bg-card flex flex-col gap-3 rounded-xl border p-2 @max-[600px]:sticky @max-[600px]:bottom-[calc(5.5rem+env(safe-area-inset-bottom))] @max-[600px]:z-10 @max-[600px]:shadow-lg @min-[600px]:w-60 @min-[600px]:shrink-0 @min-[600px]:self-start @min-[600px]:p-3"
    >
      <h2 className="text-base font-bold @max-[600px]:sr-only">Battle setup</h2>
      <div className="flex flex-col gap-3 @max-[600px]:hidden">
        <BattleSetupControls autoCombat={autoCombat}>{children}</BattleSetupControls>
      </div>
      <Button
        variant="outline"
        className="h-11 justify-between @min-[600px]:hidden"
        onClick={() => setIsOpen(true)}
      >
        <span className="truncate">
          Loadouts{autoCombat ? ` · auto combat ${isAutoCombat ? "on" : "off"}` : ""}
        </span>
        <span className="text-primary flex items-center gap-1 font-semibold">
          <SlidersHorizontal className="h-4 w-4" aria-hidden /> Setup
        </span>
      </Button>
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          // Strict containment would ignore the content's height; keep it content-sized.
          style={{ contain: "layout paint" }}
        >
          <SheetTitle className="mb-3">Battle setup</SheetTitle>
          <div className="flex flex-col gap-3">
            <BattleSetupControls autoCombat={autoCombat}>
              {children}
            </BattleSetupControls>
          </div>
        </SheetContent>
      </Sheet>
      {action}
    </aside>
  );
}

/** The jutsu and item loadouts, the optional auto combat switch and any extra options. */
export function BattleSetupControls({
  autoCombat,
  children,
}: {
  autoCombat?: boolean;
  children?: React.ReactNode;
}) {
  const [isAutoCombat, setAutoCombat] = useAutoCombatSetting();
  return (
    <>
      <JutsuLoadoutSelector variant="dropdown" label="Jutsu loadout" />
      <ItemLoadoutSelector variant="dropdown" label="Item loadout" />
      {autoCombat && (
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Bot className="h-4 w-4" aria-hidden /> Auto combat
            </p>
            <p className="text-muted-foreground text-xs">
              Your{" "}
              <Link href="/profile/edit" className="underline hover:text-orange-500">
                AI profile
              </Link>{" "}
              fights for you; take back control at any time.
            </p>
          </div>
          <Switch
            checked={isAutoCombat}
            onCheckedChange={setAutoCombat}
            aria-label="Toggle auto combat"
          />
        </div>
      )}
      {children}
    </>
  );
}
