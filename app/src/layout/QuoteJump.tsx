"use client";

import { CornerLeftUp } from "lucide-react";
import type React from "react";
import { showMutationToast } from "@/libs/toast";

/**
 * A quote's attribution as a button that scrolls to the quoted message in the same
 * conversation list and outlines it briefly. A message that is not loaded yet is named
 * as further back instead.
 */
export function QuoteJump({ commentId, author, children }: QuoteJumpProps) {
  const jump = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const target = findQuotedMessage(event.currentTarget, commentId);
    if (!target) {
      showMutationToast({
        success: false,
        message: "That message is further back in the chat. Scroll up to load it.",
        id: "quote-jump",
      });
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add(...JUMP_OUTLINE);
    window.setTimeout(() => target.classList.remove(...JUMP_OUTLINE), 1600);
  };

  return (
    <button
      type="button"
      aria-label={`Jump to the quoted message from ${author}`}
      onClick={jump}
      className="inline-flex cursor-pointer items-center gap-1 text-left hover:text-foreground hover:underline"
    >
      {children}
      <CornerLeftUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </button>
  );
}

/** Classes that outline the message a quote jumped to. */
const JUMP_OUTLINE = ["rounded-md", "ring-2", "ring-primary", "ring-offset-2"];

/**
 * The quoted message nearest the quote: the closest ancestor holding a row with that id,
 * so the Tavern page and the chat panel each jump within their own list.
 */
const findQuotedMessage = (from: HTMLElement, commentId: string) => {
  if (!/^[\w-]+$/.test(commentId)) return null;
  for (let node = from.parentElement; node; node = node.parentElement) {
    const match = node.querySelector<HTMLElement>(`[data-comment-id="${commentId}"]`);
    if (match) return match;
  }
  return null;
};

interface QuoteJumpProps {
  commentId: string;
  author: string;
  children: React.ReactNode;
}
