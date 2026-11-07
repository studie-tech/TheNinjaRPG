"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/libs/shadui";

/**
 * One emoji reaction: its count, who reacted on hover or focus, and a toggle for yours.
 * Render it inside a `TooltipProvider`.
 */
export function ReactionPill(props: ReactionPillProps) {
  const { emoji, usernames, isMine, onToggle, size = "sm" } = props;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${emoji} ${usernames.length}, reacted by ${listNames(usernames)}`}
          aria-pressed={isMine}
          disabled={!onToggle}
          onClick={onToggle}
          className={cn(
            "inline-flex cursor-pointer items-center gap-[4px] rounded-full border bg-muted/60 transition-colors hover:border-primary/60 hover:bg-muted disabled:cursor-default",
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
      <TooltipContent
        side="top"
        className="max-w-[240px] border bg-poppopover p-[8px] text-poppopover-foreground shadow-md"
      >
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
      </TooltipContent>
    </Tooltip>
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
