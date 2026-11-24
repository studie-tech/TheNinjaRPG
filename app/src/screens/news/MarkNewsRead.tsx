"use client";

import { useMarkNewsRead } from "@/hooks/useMarkNewsRead";

/** Clears the player's unread-news badge once the news board has been opened. */
export function MarkNewsRead() {
  useMarkNewsRead();
  return null;
}
