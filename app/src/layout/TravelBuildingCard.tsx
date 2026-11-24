"use client";

import { DoorOpen, Footprints, X } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverArrow,
  PopoverContent,
} from "@/components/ui/popover";
import type { VillageStructure } from "@/drizzle/schema";

/** Keep building actions attached to their artwork as the travel camera moves. */
export const TravelBuildingCard = ({
  structure,
  services,
  getBounds,
  boundary,
  onGoTo,
  onEnter,
  openingServiceId,
  onClose,
}: {
  structure: VillageStructure;
  /** Pages available at this building, including before the player arrives. */
  services: VillageStructure[];
  /** Live scene bounds for this mount's building; callers key the card by building ID. */
  getBounds: () => DOMRect | null;
  boundary: HTMLElement | null;
  onGoTo: () => void;
  onEnter: (service: VillageStructure) => void;
  openingServiceId?: string | null;
  onClose: () => void;
}) => {
  const titleId = useId();
  const anchorRef = useRef({
    getBoundingClientRect: () =>
      getBounds() ?? DOMRect.fromRect({ x: -10000, y: -10000 }),
  });
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        aria-labelledby={titleId}
        side="top"
        sideOffset={8}
        collisionBoundary={boundary}
        // Leave the map's menu controls and Day/Night indicator accessible above the card.
        collisionPadding={{ top: 80, right: 8, bottom: 8, left: 8 }}
        hideWhenDetached
        // Radix follows the virtual artwork bounds without rerendering the sector.
        updatePositionStrategy="always"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => {
          // A canvas gesture may be a pan; actual map taps own selection/dismissal.
          if (event.target instanceof Node && boundary?.contains(event.target))
            event.preventDefault();
        }}
        className="w-64 max-w-[var(--radix-popover-content-available-width)] rounded-xl p-0 shadow-xl"
      >
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          <h3
            id={titleId}
            className="min-w-0 flex-1 text-base leading-snug font-semibold break-words"
          >
            {services.length === 1 ? services[0]?.name : structure.name}
          </h3>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground size-10 shrink-0 rounded-full"
            aria-label="Close building actions"
            onClick={onClose}
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-2 px-3 pb-3">
          {services.length ? (
            services.map((service) => (
              <Button
                key={service.id}
                aria-label={`Enter ${service.name}`}
                disabled={!!openingServiceId}
                loading={openingServiceId === service.id}
                onClick={() => onEnter(service)}
                className="h-auto min-h-12 w-full justify-between gap-3 py-2 text-base whitespace-normal"
              >
                <span className="min-w-0 break-words">
                  {services.length === 1 ? "Enter" : service.name}
                </span>
                <DoorOpen aria-hidden className="size-4 shrink-0" />
              </Button>
            ))
          ) : (
            <Button
              className="h-auto min-h-12 w-full justify-between gap-3 py-2 text-base"
              aria-label={`Go to ${structure.name}`}
              onClick={onGoTo}
            >
              Go here
              <Footprints aria-hidden className="size-4 shrink-0" />
            </Button>
          )}
        </div>
        <PopoverArrow className="fill-popover" width={12} height={6} />
      </PopoverContent>
    </Popover>
  );
};
