"use client";

import React from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Settings2, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGameSettings } from "@/layout/GameSettings";
import { SortableList } from "@/components/ui/sortable-list";
import { safeLocalStorageSetItem } from "@/hooks/localstorage";
import {
  COMBAT_LAYOUT_COMPONENTS,
  DEFAULT_LAYOUT_ORDER,
  type CombatLayoutComponentId,
} from "@/hooks/combat";
import type { UserWithRelations } from "@/routers/profile";
import type { CombatPreferences } from "@/hooks/combat";

interface UserCombatSettingsProps {
  config: CombatPreferences;
  userData?: UserWithRelations | null;
  updateUser?: (data: Partial<UserWithRelations>) => Promise<void>;
}

export const UserCombatSettings: React.FC<UserCombatSettingsProps> = ({
  config,
  userData,
  updateUser,
}) => {
  const { sfxOn, setSfxOn, lightLayout, setLightLayout, updatePreferences } =
    useGameSettings(userData);

  const [initialLightLayout] = React.useState<boolean>(lightLayout);
  const [lightLayoutChanged, setLightLayoutChanged] = React.useState(false);

  React.useEffect(() => {
    setLightLayoutChanged(lightLayout !== initialLightLayout);
  }, [lightLayout, initialLightLayout]);

  const handleSfxToggle = (checked: boolean) => {
    setSfxOn(checked);
    if (userData) {
      updatePreferences({
        preferredStat: userData.preferredStat ?? null,
        preferredGeneral1: userData.preferredGeneral1 ?? null,
        preferredGeneral2: userData.preferredGeneral2 ?? null,
        sfxOn: checked,
      });
      if (updateUser) {
        void updateUser({ sfxOn: checked });
      }
    } else {
      safeLocalStorageSetItem("sfxOn", JSON.stringify(checked));
    }
  };

  const handleRefreshPage = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <div
          aria-label="Open combat settings"
          className="flex h-10 w-10 min-h-10 min-w-10 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Settings2 className="h-6 w-6" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-5" sideOffset={8}>
        <section className="space-y-3 rounded-lg border p-3">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">
            Battle visuals
          </p>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="text-sm font-semibold">Grid numbers</p>
              <p className="text-xs text-muted-foreground">Toggle coordinate labels</p>
            </div>
            <Switch
              checked={config.showGridNumbers}
              onCheckedChange={config.toggleGridNumbers}
              aria-label="Toggle grid numbers"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="text-sm font-semibold">Light layout</p>
              <p className="text-xs text-muted-foreground">
                {lightLayout ? "Enabled" : "Disabled"}
              </p>
            </div>
            <Switch
              checked={!!lightLayout}
              onCheckedChange={setLightLayout}
              aria-label="Toggle light layout"
            />
          </div>
        </section>

        <section className="space-y-3 rounded-lg border p-3">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">
            Interface
          </p>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="text-sm font-semibold">Small action icons</p>
              <p className="text-xs text-muted-foreground">
                Hide labels and fit more per row
              </p>
            </div>
            <Switch
              checked={config.useSmallActions}
              onCheckedChange={config.toggleSmallActions}
              aria-label="Toggle compact action icons"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="text-sm font-semibold">Show battle log</p>
              <p className="text-xs text-muted-foreground">
                Display combat history below the field
              </p>
            </div>
            <Switch
              checked={config.showBattleLog}
              onCheckedChange={config.toggleBattleLog}
              aria-label="Toggle battle log visibility"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="text-sm font-semibold">Show timeline</p>
              <p className="text-xs text-muted-foreground">
                Display recent actions timeline
              </p>
            </div>
            <Switch
              checked={config.showTimeline}
              onCheckedChange={config.toggleTimeline}
              aria-label="Toggle combat timeline visibility"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="text-sm font-semibold">Show basic actions</p>
              <p className="text-xs text-muted-foreground">
                Include basic actions in timeline
              </p>
            </div>
            <Switch
              checked={config.showBasicActions}
              onCheckedChange={config.toggleBasicActions}
              aria-label="Toggle basic actions in timeline"
            />
          </div>
        </section>

        <section className="space-y-3 rounded-lg border p-3">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground">
            Audio
          </p>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="text-sm font-semibold">Sound SFX</p>
              <p className="text-xs text-muted-foreground">
                {sfxOn ? "Enabled" : "Disabled"}
              </p>
            </div>
            <Switch
              checked={!!sfxOn}
              onCheckedChange={handleSfxToggle}
              aria-label="Toggle sound effects"
            />
          </div>
        </section>

        <section className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase text-muted-foreground">
              Layout Order
            </p>
            {JSON.stringify(config.layoutOrder) !==
              JSON.stringify(DEFAULT_LAYOUT_ORDER) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
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
                label: COMBAT_LAYOUT_COMPONENTS.find((c) => c.id === id)?.label ?? id,
              }))}
            onReorder={(items) => {
              const reorderedIds = items.map(
                (item) => item.id as CombatLayoutComponentId,
              );
              // Hidden items stay at the end in their original relative order
              const hiddenIds = config.layoutOrder.filter(
                (id) =>
                  (id === "timeline" && !config.showTimeline) ||
                  (id === "battlelog" && !config.showBattleLog),
              );
              config.setLayoutOrder([...reorderedIds, ...hiddenIds]);
            }}
            itemClassName="py-1.5"
          />
          <div className="flex items-center justify-between gap-3 pt-2 border-t">
            <div className="flex flex-col">
              <p className="text-sm font-semibold">Use tabs</p>
              <p className="text-xs text-muted-foreground">
                Group actions, timeline & log in tabs
              </p>
            </div>
            <Switch
              checked={config.useTabs}
              onCheckedChange={config.toggleUseTabs}
              aria-label="Toggle tabs layout"
            />
          </div>
        </section>

        {lightLayoutChanged && (
          <Button
            onClick={handleRefreshPage}
            variant="default"
            size="sm"
            className="w-full"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh to apply
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
};
