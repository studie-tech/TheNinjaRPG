"use client";

import { CornerLeftUp } from "lucide-react";
import type React from "react";
import { showMutationToast } from "@/libs/toast";

/**
 * A quote's attribution as a button that scrolls to the quoted message in the same
 * conversation list and outlines it briefly. Missing messages keep the reader in that list.
 */
export function QuoteJump({ commentId, author, children }: QuoteJumpProps) {
  const jump = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const target = findQuotedMessage(event.currentTarget, commentId);
    if (!target) {
      showMutationToast({
        success: false,
        title: "Message unavailable",
        message:
          "That message is not in this view. Try loading more messages or clearing the search.",
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
      className="hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-left hover:underline"
    >
      {children}
      <CornerLeftUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </button>
  );
}

/** Classes that outline the message a quote jumped to. */
const JUMP_OUTLINE = ["rounded-md", "ring-2", "ring-inset", "ring-primary"];

/** Find a message only within this rendered list, even when the same chat is open twice. */
const findQuotedMessage = (from: HTMLElement, commentId: string) => {
  // Comment ids are nanoids; reject values that cannot safely enter the selector.
  if (!/^[\w-]+$/.test(commentId)) return null;
  return from
    .closest("[data-conversation-comments]")
    ?.querySelector<HTMLElement>(`[data-comment-id="${commentId}"]`);
};

interface QuoteJumpProps {
  commentId: string;
  author: string;
  children: React.ReactNode;
}
