"use client";

import dynamic from "next/dynamic";
import type React from "react";

export interface AppEmojiPickerProps {
  onSelect: (native: string) => void;
  onClickOutside?: () => void;
  autoFocus?: boolean;
  perLine?: number;
}

const DEFAULT_PER_LINE = 9;
/**
 * What emoji-mart's own grid measures once it renders, used only to reserve the space. Both
 * are observed rather than derived: under `dynamicWidth` the picker sizes itself and works out
 * perLine from the result, so neither perLine nor the container gives the number away — the
 * popovers this sits in are absolutely positioned and have no width of their own to inherit.
 */
const PICKER_WIDTH = 300;
const PICKER_HEIGHT = 435;

/**
 * The picker and its dataset load together, behind this one boundary.
 *
 * `@emoji-mart/data` is a 432 KB JSON module whose default export is consumed whole, so nothing
 * can tree-shake it: it lands in whatever chunk imports it. A static import would place it in the
 * root layout's graph (Comment and RichInput reach this file), making every signed-in page
 * download and parse the emoji set for a popover most players never open.
 */
const EmojiMartPicker = dynamic(
  () => import("./EmojiPickerImpl").then((module) => module.EmojiPickerImpl),
  {
    ssr: false,
    // Reserves the popover's shape while the picker chunk loads
    loading: () => (
      <div
        className="rounded-lg border border-border bg-popover"
        style={{ width: PICKER_WIDTH, height: PICKER_HEIGHT }}
      />
    ),
  },
);

/**
 * Under `dynamicWidth` emoji-mart fills its parent and recounts its columns whenever that parent
 * resizes. The fixed box keeps a popover without a width of its own from growing with the
 * preview line, where a long emoji name would otherwise reflow the grid on every hover.
 */
export const EmojiPicker: React.FC<AppEmojiPickerProps> = (props) => (
  <div style={{ width: PICKER_WIDTH }}>
    <EmojiMartPicker
      autoFocus={props.autoFocus}
      perLine={props.perLine ?? DEFAULT_PER_LINE}
      emojiSize={24}
      emojiButtonSize={36}
      dynamicWidth={true}
      onEmojiSelect={(emoji: { native?: string }) => {
        if (emoji.native) props.onSelect(emoji.native);
      }}
      onClickOutside={props.onClickOutside}
    />
  </div>
);
