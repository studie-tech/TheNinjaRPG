"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { IMG_URL_HANDPOINTER } from "@/drizzle/constants";
import Image from "@/layout/Image";
import { cn } from "@/libs/shadui";

/**
 * Marks a control of the raised Activity dock the way the spotlight marks one on the page:
 * the page dims behind the dock, and the control gets the amber ring and the hand. The
 * spotlight itself lies under the raised dock, so it cannot reach controls there.
 */
export const DockHighlight = ({
  active,
  pointerClassName = "right-6",
  children,
}: {
  active: boolean;
  /** Where along the control the hand points. */
  pointerClassName?: string;
  children: ReactNode;
}) => (
  <div className="relative" data-tutorial-dock-highlight={active ? "" : undefined}>
    {active &&
      createPortal(
        // Below the open lesson's dock (z-[61]); page controls stay reachable.
        <div
          data-battle-focus-layer
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[60] bg-black/55"
        />,
        document.body,
      )}
    {active && (
      <span className="pointer-events-none absolute -inset-1.5 z-[1] rounded-lg border-[3px] border-amber-400 shadow-[0_0_18px_rgba(245,158,11,0.8)]">
        <span className="animate-spotlight-ping absolute inset-0 rounded-lg motion-reduce:animate-none" />
      </span>
    )}
    {children}
    {active && (
      <Image
        src={IMG_URL_HANDPOINTER}
        alt=""
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -top-12 z-[1] h-12 w-12 rotate-180 animate-bounce drop-shadow-lg motion-reduce:animate-none",
          pointerClassName,
        )}
        width={80}
        height={80}
      />
    )}
  </div>
);
