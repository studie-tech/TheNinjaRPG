"use client";

import { RefreshCw, RotateCcw, Settings2 } from "lucide-react";
import React from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SortableList } from "@/components/ui/sortable-list";
import { Switch } from "@/components/ui/switch";
import type { CombatPreferences } from "@/hooks/combat";
import {
  COMBAT_LAYOUT_COMPONENTS,
  type CombatLayoutComponentId,
  DEFAULT_LAYOUT_ORDER,
} from "@/hooks/combat";
import { safeLocalStorageSetItem } from "@/hooks/localstorage";
import { useGameSettings } from "@/layout/GameSettings";
import type { UserWithRelations } from "@/routers/profile";

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
        <button
          type="button"
          aria-label="Open combat settings"
          className="flex h-10 min-h-10 w-10 min-w-10 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <Settings2 className="h-6 w-6" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-5" sideOffset={8}>
        <section className="space-y-3 rounded-lg border p-3">
          <p className="font-semibold text-[10px] text-muted-foreground uppercase">
            Battle visuals
          </p>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="font-semibold text-sm">Grid numbers</p>
              <p className="text-muted-foreground text-xs">Toggle coordinate labels</p>
            </div>
            <Switch
              checked={config.showGridNumbers}
              onCheckedChange={config.toggleGridNumbers}
              aria-label="Toggle grid numbers"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="font-semibold text-sm">Light layout</p>
              <p className="text-muted-foreground text-xs">
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
          <p className="font-semibold text-[10px] text-muted-foreground uppercase">
            Interface
          </p>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="font-semibold text-sm">Small action icons</p>
              <p className="text-muted-foreground text-xs">
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
              <p className="font-semibold text-sm">Show battle log</p>
              <p className="text-muted-foreground text-xs">
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
              <p className="font-semibold text-sm">Show timeline</p>
              <p className="text-muted-foreground text-xs">
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
              <p className="font-semibold text-sm">Show basic actions</p>
              <p className="text-muted-foreground text-xs">
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
          <p className="font-semibold text-[10px] text-muted-foreground uppercase">
            Audio
          </p>
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <p className="font-semibold text-sm">Sound SFX</p>
              <p className="text-muted-foreground text-xs">
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
            <p className="font-semibold text-[10px] text-muted-foreground uppercase">
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
          <div className="flex items-center justify-between gap-3 border-t pt-2">
            <div className="flex flex-col">
              <p className="font-semibold text-sm">Use tabs</p>
              <p className="text-muted-foreground text-xs">
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
