import type { CSSProperties } from "react";
import type { SpeechSide, SpeechTone } from "@/libs/mapSpeech";
import { cn } from "@/libs/shadui";

/**
 * A character's words in a speech bubble: their name on a plate, the line, and any controls
 * that answer it. `side` is where the bubble stands from the speaker and `tail` how far along
 * the facing edge its tail points at them; left out, both come from a `group/speech` ancestor, which can move
 * them without a render. Purely presentational, for a map, a battle or a
 * scene; `MapSpeech` places it on a map.
 */
export const SpeechBubble = ({
  speaker,
  tone = "say",
  side,
  tail,
  footer,
  className,
  children,
}: {
  speaker?: string;
  tone?: SpeechTone;
  side?: SpeechSide;
  /** A CSS length; the middle of the edge when left out. */
  tail?: string;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) => (
  <div
    data-speech-side={side}
    className={cn(
      "group/speech bg-card text-card-foreground relative w-max max-w-full rounded-xl border-2 px-3 py-2 text-base leading-snug text-pretty shadow-lg",
      TONE_CLASS[tone],
      className,
    )}
  >
    <span
      aria-hidden="true"
      className={cn(
        "bg-card absolute size-3 rotate-45 border-inherit",
        TAIL_CLASS,
        tone === "thought" && "rounded-full border-2",
      )}
      style={
        tail === undefined ? undefined : ({ "--speech-tail": tail } as CSSProperties)
      }
    />
    {speaker && (
      <p className="text-primary mb-0.5 font-bold dark:text-amber-300">{speaker}</p>
    )}
    <div
      className={cn(tone === "shout" && "font-bold", tone === "thought" && "italic")}
    >
      {children}
    </div>
    {footer && (
      <div className="pointer-events-auto mt-3 flex flex-wrap justify-end gap-2">
        {footer}
      </div>
    )}
  </div>
);

const TONE_CLASS: Record<SpeechTone, string> = {
  say: "border-primary",
  shout: "border-red-700",
  thought: "border-dashed border-muted-foreground",
};

/** The tail is a square turned on its corner, showing only the two borders that leave the bubble. */
const TAIL_CLASS = [
  "group-data-[speech-side=above]/speech:-bottom-[7px] group-data-[speech-side=above]/speech:left-(--speech-tail,50%) group-data-[speech-side=above]/speech:-translate-x-1/2 group-data-[speech-side=above]/speech:border-r-2 group-data-[speech-side=above]/speech:border-b-2",
  "group-data-[speech-side=below]/speech:-top-[7px] group-data-[speech-side=below]/speech:left-(--speech-tail,50%) group-data-[speech-side=below]/speech:-translate-x-1/2 group-data-[speech-side=below]/speech:border-t-2 group-data-[speech-side=below]/speech:border-l-2",
  "group-data-[speech-side=left]/speech:top-(--speech-tail,50%) group-data-[speech-side=left]/speech:-right-[7px] group-data-[speech-side=left]/speech:-translate-y-1/2 group-data-[speech-side=left]/speech:border-t-2 group-data-[speech-side=left]/speech:border-r-2",
  "group-data-[speech-side=right]/speech:top-(--speech-tail,50%) group-data-[speech-side=right]/speech:-left-[7px] group-data-[speech-side=right]/speech:-translate-y-1/2 group-data-[speech-side=right]/speech:border-b-2 group-data-[speech-side=right]/speech:border-l-2",
];
