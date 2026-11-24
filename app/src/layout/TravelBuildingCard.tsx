"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import type { VillageStructure } from "@/drizzle/schema";
import Link from "@/layout/Link";

/** Keep building actions attached to their artwork as the travel camera moves. */
export const TravelBuildingCard = ({
  structure,
  services,
  getBounds,
  boundary,
  onGoTo,
  onClose,
}: {
  structure: VillageStructure;
  /** Available services at the player's current building; empty before arrival. */
  services: VillageStructure[];
  /** Live scene bounds for this mount's building; callers key the card by building ID. */
  getBounds: () => DOMRect | null;
  boundary: HTMLElement | null;
  onGoTo: () => void;
  onClose: () => void;
}) => {
  const anchorRef = useRef({
    getBoundingClientRect: () =>
      getBounds() ?? DOMRect.fromRect({ x: -10000, y: -10000 }),
  });
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        aria-label={`${structure.name} actions`}
        side="top"
        sideOffset={8}
        collisionBoundary={boundary}
        collisionPadding={8}
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
        className="w-auto max-w-[min(24rem,var(--radix-popover-content-available-width))] p-3"
      >
        <p className="text-sm font-semibold">
          {services.length
            ? services.map((service) => service.name).join(" · ")
            : structure.name}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {services.length ? (
            services.map((service) => (
              <Button key={service.id} asChild size="sm" className="min-h-10">
                <Link href={service.route}>Enter {service.name}</Link>
              </Button>
            ))
          ) : (
            <Button size="sm" className="min-h-10" onClick={onGoTo}>
              Go to {structure.name}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
