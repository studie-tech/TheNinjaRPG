"use client";

import type React from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalStorage } from "@/hooks/localstorage";
import {
  DEFAULT_MOBILE_NAV_CONFIG,
  getNavOptionById,
  MOBILE_NAV_OPTIONS,
  MOBILE_NAV_STORAGE_KEY,
  type MobileNavConfig,
  normalizeMobileNavConfig,
} from "@/libs/mobileNavConfig";

/**
 * Mobile Navigation Settings component
 */
export const MobileNavSettings: React.FC = () => {
  const [config, setConfig] = useLocalStorage<MobileNavConfig>(
    MOBILE_NAV_STORAGE_KEY,
    DEFAULT_MOBILE_NAV_CONFIG,
  );

  const normalizedConfig = normalizeMobileNavConfig(config);

  // Get all selected IDs to filter duplicates
  const selectedIds = [...normalizedConfig.left, ...normalizedConfig.right];

  const handleSlotChange = (side: "left" | "right", index: number, newId: string) => {
    const newSide = [...normalizedConfig[side]];
    newSide[index] = newId;
    setConfig({ ...normalizedConfig, [side]: newSide });
  };

  const handleReset = () => {
    setConfig(DEFAULT_MOBILE_NAV_CONFIG);
  };

  const renderSlotSelector = (
    currentId: string,
    onChange: (newId: string) => void,
    label: string,
  ) => {
    const current = getNavOptionById(currentId);
    if (!current) return null;
    return (
      <div className="flex items-center gap-2">
        <Label className="w-16 text-sm">{label}</Label>
        <Select value={currentId} onValueChange={onChange}>
          <SelectTrigger className="w-full">
            <SelectValue>
              <div className="flex items-center gap-2">
                <current.icon className="h-4 w-4" />
                <span>{current.name}</span>
              </div>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {MOBILE_NAV_OPTIONS.map((option) => {
              const isDisabled =
                selectedIds.includes(option.id) && option.id !== currentId;
              return (
                <SelectItem key={option.id} value={option.id} disabled={isDisabled}>
                  <div className="flex items-center gap-2">
                    <option.icon className="h-4 w-4" />
                    <span>{option.name}</span>
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <div className="space-y-4 p-3">
      <p className="text-muted-foreground text-sm">
        Customize the 5 buttons shown in your mobile navigation bar. The center button
        automatically shows Village or Travel based on your location. Note: If you
        configure Travel in a slot, it will be hidden when outside the village (since
        the center button already shows Travel in that case).
      </p>

      <div className="space-y-3">
        <div className="font-semibold text-sm">Left Side (2 buttons)</div>
        {normalizedConfig.left.map((id, index) => (
          <div key={`left-${index}`}>
            {renderSlotSelector(
              id,
              (newId) => handleSlotChange("left", index, newId),
              `Slot ${index + 1}`,
            )}
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="font-semibold text-sm">Right Side (3 buttons)</div>
        {normalizedConfig.right.map((id, index) => (
          <div key={`right-${index}`}>
            {renderSlotSelector(
              id,
              (newId) => handleSlotChange("right", index, newId),
              `Slot ${index + 1}`,
            )}
          </div>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={handleReset}>
        Reset to Default
      </Button>
    </div>
  );
};
