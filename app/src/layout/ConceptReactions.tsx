import { Loader2 } from "lucide-react";
import type React from "react";
import { cn } from "@/libs/shadui";

const REACTIONS = [
  { type: "like", emoji: "❤️", count: "n_likes", name: "heart" },
  { type: "love", emoji: "👍", count: "n_loves", name: "thumbs-up" },
  { type: "laugh", emoji: "🤣", count: "n_laugh", name: "laugh" },
] as const;

/** Heart, thumbs-up and laugh toggles of a concept art image. */
export const ConceptReactions: React.FC<ConceptReactionsProps> = (props) => {
  const { image, userId, pendingEmotion, disabled, onToggle } = props;
  return REACTIONS.map(({ type, emoji, count, name }, index) => {
    const isActive = image.likes?.some(
      (like) => like.userId === userId && like.type === type,
    );
    return (
      <button
        key={type}
        type="button"
        className={cn(
          index === 0 && props.firstButtonClassName,
          props.buttonClassName,
          isActive && "bg-slate-700",
        )}
        disabled={disabled}
        aria-busy={pendingEmotion === type}
        aria-pressed={!!isActive}
        aria-label={
          pendingEmotion === type
            ? "Updating"
            : `${isActive ? "Remove" : "Add"} ${name} reaction`
        }
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle(type);
        }}
      >
        {pendingEmotion === type && (
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        )}
        {emoji} {image[count]}
      </button>
    );
  });
};

export type ConceptEmotion = "like" | "love" | "laugh";

interface ConceptReactionsProps {
  image: {
    likes?: { userId: string; type: string }[] | null;
    n_likes: number;
    n_loves: number;
    n_laugh: number;
  };
  userId: string | undefined;
  pendingEmotion: ConceptEmotion | null | undefined;
  disabled: boolean;
  /** Layout classes of every button; the toggled state and icon are shared. */
  buttonClassName: string;
  firstButtonClassName?: string;
  onToggle: (type: ConceptEmotion) => void;
}
