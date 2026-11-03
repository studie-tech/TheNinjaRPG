"use client";

import { RefreshCw, RotateCcw, Settings2 } from "lucide-react";
import React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SortableList } from "@/components/ui/sortable-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CombatPreferences } from "@/hooks/combat";
import {
  COMBAT_LAYOUT_COMPONENTS,
  type CombatLayoutComponentId,
  DEFAULT_LAYOUT_ORDER,
} from "@/hooks/combat";
import { useLocalStorage } from "@/hooks/localstorage";
import {
  SettingsToggle,
  useGameSettings,
  VisualEffectsSettings,
} from "@/layout/GameSettings";
import type { UserWithRelations } from "@/routers/profile";

/** Battle controls and panel ordering stay separate from the shared graphics preferences. */
export const UserCombatSettings: React.FC<UserCombatSettingsProps> = ({
  config,
  userData,
  autoCombatControl,
  supportsBattleFocus = true,
}) => {
  const { sfxOn, setSfxEnabled, lightLayout, setLightLayout } =
    useGameSettings(userData);
  const [settingsTab, setSettingsTab] = useLocalStorage<string>(
    "combatSettingsTab",
    "battle",
  );
  const activeSettingsTab = ["battle", "layout", "effects"].includes(settingsTab)
    ? settingsTab
    : "battle";
  const [initialLightLayout] = React.useState(lightLayout);
  const lightLayoutChanged = lightLayout !== initialLightLayout;
  const resourceBarsId = React.useId();
  const battleFocus = supportsBattleFocus && config.battleFocus;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Open combat settings"
          className="flex h-10 min-h-10 w-10 min-w-10 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Settings2 className="h-6 w-6" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Combat settings"
        collisionPadding={8}
        className="max-h-[min(80dvh,var(--radix-popover-content-available-height))] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto"
        sideOffset={8}
      >
        <Tabs
          value={activeSettingsTab}
          onValueChange={setSettingsTab}
          className="min-w-0"
        >
          <TabsList
            aria-label="Combat settings categories"
            className="sticky top-0 z-10 flex-nowrap"
          >
            <TabsTrigger value="battle" className="min-h-9 flex-1 px-2 text-xs">
              Battle
            </TabsTrigger>
            <TabsTrigger value="layout" className="min-h-9 flex-1 px-2 text-xs">
              Layout
            </TabsTrigger>
            <TabsTrigger value="effects" className="min-h-9 flex-1 px-2 text-xs">
              Visual effects
            </TabsTrigger>
          </TabsList>
          <TabsContent value="battle" className="space-y-3 pt-2">
            <p className="text-base font-semibold">Battle interface</p>
            {autoCombatControl && (
              <div className="border-b pb-3">{autoCombatControl}</div>
            )}
            <div className="space-y-2">
              <Label htmlFor={resourceBarsId} className="text-sm">
                Resource bars
              </Label>
              <p
                id={`${resourceBarsId}-description`}
                className="text-muted-foreground text-xs"
              >
                HP, chakra and stamina on the battlefield
              </p>
              <Select
                value={config.resourceBarsVisibility}
                onValueChange={(value) => {
                  if (value === "mobile-only" || value === "on" || value === "off")
                    config.setResourceBarsVisibility(value);
                }}
              >
                <SelectTrigger
                  id={resourceBarsId}
                  aria-describedby={`${resourceBarsId}-description`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mobile-only">Mobile only</SelectItem>
                  <SelectItem value="on">On</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="divide-border/50 divide-y">
              <SettingsToggle
                label="Grid numbers"
                description="Coordinates on the battlefield"
                checked={config.showGridNumbers}
                onCheckedChange={config.toggleGridNumbers}
              />
              {!battleFocus && (
                <SettingsToggle
                  label="Small action icons"
                  description="Hide labels and fit more per row"
                  checked={config.useSmallActions}
                  onCheckedChange={config.toggleSmallActions}
                />
              )}
              <SettingsToggle
                label="Aggro meters"
                description="Team aggro against NPCs; tap for details"
                checked={config.showAggro}
                onCheckedChange={config.toggleAggro}
              />
              <SettingsToggle
                label="Combat sounds"
                description="Shared with game audio settings"
                checked={!!sfxOn}
                onCheckedChange={setSfxEnabled}
              />
            </div>
          </TabsContent>
          <TabsContent value="layout" className="space-y-3 pt-2">
            <p className="text-base font-semibold">Combat layout</p>
            {supportsBattleFocus && (
              <SettingsToggle
                label="Battle focus"
                description="Full-window battlefield with compact actions, log and timeline"
                checked={battleFocus}
                onCheckedChange={config.setBattleFocus}
              />
            )}
            {/* Focus always exposes history; desktop can swap it with the actions. */}
            {battleFocus && (
              <div className="hidden lg:block">
                <SettingsToggle
                  label="Swap actions and log"
                  description="Put the log below the field and actions beside it"
                  checked={config.swapFocusPanels}
                  onCheckedChange={config.setSwapFocusPanels}
                />
              </div>
            )}
            <div className="divide-border/50 divide-y">
              {!battleFocus && (
                <>
                  <SettingsToggle
                    label="Show battle log"
                    description="Combat history below the field"
                    checked={config.showBattleLog}
                    onCheckedChange={config.toggleBattleLog}
                  />
                  <SettingsToggle
                    label="Show timeline"
                    description="Recent actions in the battle"
                    checked={config.showTimeline}
                    onCheckedChange={config.toggleTimeline}
                  />
                </>
              )}
              <SettingsToggle
                label="Show basic actions"
                description="Include basic actions in the timeline"
                checked={config.showBasicActions}
                disabled={!battleFocus && !config.showTimeline}
                onCheckedChange={config.toggleBasicActions}
              />
              {!battleFocus && (
                <SettingsToggle
                  label="Use tabs"
                  description="Group actions, timeline and log in tabs"
                  checked={config.useTabs}
                  onCheckedChange={config.toggleUseTabs}
                />
              )}
            </div>
            {!battleFocus && (
              <div className="space-y-2 border-t pt-3">
                <div className="flex min-h-8 items-center justify-between gap-2">
                  <p className="text-sm font-medium">Panel order</p>
                  {JSON.stringify(config.layoutOrder) !==
                    JSON.stringify(DEFAULT_LAYOUT_ORDER) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={config.resetLayoutOrder}
                    >
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Reset
                    </Button>
                  )}
                </div>
                <SortableList
                  items={config.layoutOrder
                    .filter((id) => {
                      if (id === "timeline" && !config.showTimeline) return false;
                      if (id === "battlelog" && !config.showBattleLog) return false;
                      return true;
                    })
                    .map((id) => ({
                      id,
                      label:
                        COMBAT_LAYOUT_COMPONENTS.find(
                          (component) => component.id === id,
                        )?.label ?? id,
                    }))}
                  onReorder={(items) => {
                    const reorderedIds = items.map(
                      (item) => item.id as CombatLayoutComponentId,
                    );
                    // Hidden panels retain their relative order until shown again.
                    const hiddenIds = config.layoutOrder.filter(
                      (id) =>
                        (id === "timeline" && !config.showTimeline) ||
                        (id === "battlelog" && !config.showBattleLog),
                    );
                    config.setLayoutOrder([...reorderedIds, ...hiddenIds]);
                  }}
                  itemClassName="py-1.5"
                />
              </div>
            )}
            <div className="border-t">
              <SettingsToggle
                label="Light layout"
                checked={!!lightLayout}
                onCheckedChange={setLightLayout}
              />
              {lightLayoutChanged && (
                <Button
                  onClick={() => window.location.reload()}
                  variant="default"
                  size="sm"
                  className="w-full"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh to apply
                </Button>
              )}
            </div>
          </TabsContent>
          <TabsContent value="effects" className="space-y-3 pt-2">
            <VisualEffectsSettings />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
};

interface UserCombatSettingsProps {
  config: CombatPreferences;
  /** Embedded viewers keep their layout controls without changing the saved live preference. */
  supportsBattleFocus?: boolean;
  /** The page owns the mutation and checks whether the battle permits switching control. */
  autoCombatControl?: React.ReactNode;
  userData?: UserWithRelations | null;
}
