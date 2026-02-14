"use client";

import data from "@emoji-mart/data";
import dynamic from "next/dynamic";
import type React from "react";

export interface AppEmojiPickerProps {
  onSelect: (native: string) => void;
  onClickOutside?: () => void;
  perLine?: number;
  emojiSize?: number;
  emojiButtonSize?: number;
}

const EmojiMartPicker = dynamic(() => import("@emoji-mart/react"), { ssr: false });

export const EmojiPicker: React.FC<AppEmojiPickerProps> = (props) => {
  const perLine = props.perLine ?? 9;
  const emojiSize = props.emojiSize ?? 24;
  const emojiButtonSize = props.emojiButtonSize ?? 36;

  return (
    <EmojiMartPicker
      data={data}
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
