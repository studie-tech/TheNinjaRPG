"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/libs/shadui";

/** How long a finger rests on the pill before the list of names opens. */
export const LONG_PRESS_MS = 450;
/** Movement (px) that turns a press into a scroll and cancels the long-press. */
const LONG_PRESS_SLOP = 10;

/**
 * One emoji reaction: its count, who reacted, and a toggle for yours. Who reacted shows on
 * hover or focus, or on a long-press on touch screens, where a tap still toggles.
 * Render it inside a `TooltipProvider`.
 */
export function ReactionPill(props: ReactionPillProps) {
  const { emoji, usernames, isMine, onToggle, size = "sm" } = props;
  const [namesOpen, setNamesOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const longPressed = useRef(false);
  const pill = useRef<HTMLButtonElement>(null);

  const cancelPress = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => cancelPress, []);

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    longPressed.current = false;
    if (e.pointerType === "mouse") return;
    cancelPress();
    start.current = { x: e.clientX, y: e.clientY };
    timer.current = setTimeout(() => {
      timer.current = null;
      longPressed.current = true;
      setNamesOpen(true);
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const s = start.current;
    if (!s) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > LONG_PRESS_SLOP) cancelPress();
  };

  const names = (
    <>
      <p className="mb-[4px] border-b pb-[4px] font-semibold">
        {usernames.length} reacted with {emoji}
      </p>
      <ul className="max-h-40 overflow-y-auto">
        {usernames.map((username) => (
          <li key={username} className="truncate">
            {username}
          </li>
        ))}
      </ul>
    </>
  );
  const namesClass =
    "max-w-[240px] border bg-poppopover p-[8px] text-poppopover-foreground text-xs shadow-md";

  return (
    <Popover open={namesOpen} onOpenChange={setNamesOpen}>
      <Tooltip>
        <PopoverAnchor asChild>
          <TooltipTrigger asChild>
            <button
              ref={pill}
              type="button"
              aria-label={`${emoji} ${usernames.length}, reacted by ${listNames(usernames)}`}
              aria-pressed={isMine}
              aria-disabled={!onToggle}
              onClick={() => {
                // The click that ends a long-press only shows the names; it must not toggle.
                if (longPressed.current) {
                  longPressed.current = false;
                  return;
                }
                setNamesOpen(false);
                onToggle?.();
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={cancelPress}
              onPointerCancel={cancelPress}
              onPointerLeave={cancelPress}
              onContextMenu={(e) => e.preventDefault()}
              className={cn(
                "inline-flex cursor-pointer touch-manipulation select-none items-center gap-[4px] rounded-full border bg-muted/60 transition-colors [-webkit-touch-callout:none] hover:border-primary/60 hover:bg-muted aria-disabled:cursor-default",
                size === "sm"
                  ? "px-[8px] text-[12px] leading-[22px]"
                  : "px-[10px] text-sm leading-7",
                isMine && "border-primary bg-primary/15",
              )}
            >
              <span aria-hidden>{emoji}</span>
              <span className="font-semibold tabular-nums">{usernames.length}</span>
            </button>
          </TooltipTrigger>
        </PopoverAnchor>
        <TooltipContent side="top" className={namesClass}>
          {names}
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        collisionPadding={8}
        className={cn("w-auto min-w-[140px]", namesClass)}
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Lifting the finger focuses the pill; that must not close the names it just opened.
        onInteractOutside={(e) => {
          if (e.target instanceof Node && pill.current?.contains(e.target))
            e.preventDefault();
        }}
      >
        {names}
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Ana", "Ana and Ben", "Ana, Ben and Cy", "Ana, Ben, Cy and 3 others": the label stays short,
 * and the tooltip lists everyone.
 */
const listNames = (names: string[]) => {
  const shown = names.length > 3 ? names.slice(0, 3) : names;
  const rest = names.length - shown.length;
  if (rest > 0)
    return `${shown.join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
  return shown.length <= 1
    ? (shown[0] ?? "")
    : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
};

interface ReactionPillProps {
  emoji: string;
  usernames: string[];
  /** The viewer is among those who reacted. */
  isMine: boolean;
  /** Absent when the viewer cannot react, which disables the pill. */
  onToggle?: () => void;
  size?: "sm" | "md";
}
