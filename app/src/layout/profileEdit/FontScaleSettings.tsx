"use client";

import type React from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FONT_SCALE_OPTIONS, useFontScale } from "@/hooks/useFontScale";
import { ReadingSettings } from "@/layout/ReadingSettings";

/**
 * Font Scale Settings component
 */
export const FontScaleSettings: React.FC = () => {
  const { fontScale, setFontScale } = useFontScale();

  return (
    <div className="space-y-4 p-3">
      <p className="text-muted-foreground text-sm">
        Adjust text size for better readability. This affects all text throughout the
        game.
      </p>

      <div className="space-y-2">
        <Label>Text Size</Label>
        <Select
          value={String(fontScale)}
          onValueChange={(v) => setFontScale(Number(v) as typeof fontScale)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_SCALE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded border p-3">
        <p className="font-bold">Preview</p>
        <p>This is how your text will appear throughout the game.</p>
      </div>
      <ReadingSettings />
    </div>
  );
};
