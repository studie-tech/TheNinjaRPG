"use client";

import dynamic from "next/dynamic";
import type React from "react";

export interface AppEmojiPickerProps {
  onSelect: (native: string) => void;
  onClickOutside?: () => void;
  perLine?: number;
  emojiSize?: number;
  emojiButtonSize?: number;
}

const DEFAULT_PER_LINE = 9;
const DEFAULT_EMOJI_SIZE = 24;
const DEFAULT_EMOJI_BUTTON_SIZE = 36;
/** What emoji-mart's own grid comes out at; only used to reserve the space. */
const PICKER_HEIGHT = 435;

/**
 * The picker and its dataset load together, behind this one boundary.
 *
 * `@emoji-mart/data` is a 432 KB JSON module whose default export is consumed whole, so nothing
 * can tree-shake it: it lands in whatever chunk imports it. Importing it at the top of this file
 * put it in the root layout's graph — Comment and RichInput both reach it — so every signed-in
 * page downloaded and parsed the entire emoji set for a popover most players never open.
 */
const EmojiMartPicker = dynamic(
  async () => {
    const [picker, emojiData] = await Promise.all([
      import("@emoji-mart/react"),
      import("@emoji-mart/data"),
    ]);
    const Picker = picker.default;
    // The picker wants the parsed dataset, not the module namespace around it
    const data = emojiData.default;
    const WithData = (props: Record<string, unknown>) => (
      <Picker {...props} data={data} />
    );
    return { default: WithData };
  },
  {
    ssr: false,
    // Reserves the popover's shape for the one fetch it now takes to open. Width comes
    // from the container rather than from perLine, because dynamicWidth makes the picker
    // itself 100% wide and derive perLine from the measured width — so a perLine-based
    // guess would simply be a different number, not a better one.
    loading: () => (
      <div
        className="w-full rounded-lg border border-border bg-popover"
        style={{ height: PICKER_HEIGHT }}
      />
    ),
  },
);

export const EmojiPicker: React.FC<AppEmojiPickerProps> = (props) => {
  const perLine = props.perLine ?? DEFAULT_PER_LINE;
  const emojiSize = props.emojiSize ?? DEFAULT_EMOJI_SIZE;
  const emojiButtonSize = props.emojiButtonSize ?? DEFAULT_EMOJI_BUTTON_SIZE;

  return (
    <EmojiMartPicker
      perLine={perLine}
      emojiSize={emojiSize}
      emojiButtonSize={emojiButtonSize}
      dynamicWidth={true}
      onEmojiSelect={(emoji: unknown) => {
        const native =
          typeof emoji === "string"
            ? emoji
            : emoji &&
                typeof emoji === "object" &&
                "native" in (emoji as Record<string, unknown>)
              ? (emoji as { native: string }).native
              : "";
        if (native) props.onSelect(native);
      }}
      onClickOutside={props.onClickOutside}
    />
  );
};

export default EmojiPicker;
