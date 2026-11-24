"use client";

import { Gift, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StoryOffer } from "@/hooks/useStoryOffer";

/**
 * The answers, or the reward, a scene's speaker waits for, as the controls of a speech
 * bubble or a dialog. `onTalk` opens the conversation instead where it has several answers,
 * which need more room than a bubble. The element's id is what a lesson points at.
 */
export const StoryAnswers = ({
  offer,
  onTalk,
  talkLabel = "Answer",
}: {
  offer: StoryOffer;
  onTalk?: () => void;
  talkLabel?: string;
}) => {
  const busy = offer.isPending ? (
    <Loader2 className="mr-2 size-4 shrink-0 animate-spin" aria-hidden="true" />
  ) : null;
  const controls =
    offer.claim || (onTalk && offer.dialog && offer.dialog.answers.length > 1)
      ? [
          offer.claim
            ? { text: offer.claim.label, choose: offer.claim.claim }
            : { text: talkLabel, choose: onTalk ?? (() => undefined) },
        ]
      : (offer.dialog?.answers ?? []);
  return (
    <div id="tutorial-story-answers" className="flex flex-wrap justify-end gap-2">
      {controls.map((control, index) => (
        <Button
          key={`${index}-${control.text}`}
          type="button"
          decoration={offer.claim ? "gold" : undefined}
          className="h-auto min-h-10 max-w-full text-left whitespace-normal"
          disabled={offer.isPending}
          onClick={control.choose}
        >
          {busy ??
            (offer.claim ? (
              <Gift className="mr-2 size-4 shrink-0" aria-hidden="true" />
            ) : null)}
          {control.text}
        </Button>
      ))}
    </div>
  );
};
