"use client";

import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CharacterPreview } from "@/layout/CharacterPreview";
import type { SpriteUser } from "@/libs/lpc/appearance";

/** Load artwork on demand and use the inventory snapshot refreshed by equipment actions. */
export const EquipmentPreview = ({
  user,
  items,
}: {
  user: SpriteUser;
  items: SpriteUser["items"];
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0 gap-1.5 px-2"
        aria-label="Preview equipped appearance"
        disabled={!items}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        Preview
      </Button>
    </PopoverTrigger>
    <PopoverContent
      align="start"
      side="right"
      className="w-64 max-w-[calc(100vw-1rem)] p-3"
      aria-label="Equipped appearance"
    >
      <CharacterPreview
        className="w-full"
        label="Equipped appearance"
        user={{ ...user, items }}
      />
    </PopoverContent>
  </Popover>
);
