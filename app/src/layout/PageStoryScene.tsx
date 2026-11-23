"use client";

import { useSetAtom } from "jotai";
import { useEffect } from "react";
import { useTutorialStep } from "@/hooks/tutorial";
import { useStoryOffer } from "@/hooks/useStoryOffer";
import { spokenStepAtom, spokenTextOf, spokenWordsOf } from "@/hooks/useStoryScene";
import { SpeechBubble } from "@/layout/map/SpeechBubble";
import { StoryAnswers } from "@/layout/StoryAnswers";
import { parseHtml } from "@/utils/parse";
import { usePublicPathname } from "@/utils/routing";

/**
 * The words of whoever a lesson meets on this page (its step's `pageScene`), in a speech
 * bubble with the answers it waits for. Place it under the picture of where they stand.
 */
export const PageStoryScene = () => {
  const pathname = usePublicPathname();
  const { currentStep } = useTutorialStep();
  const step = currentStep?.scenePage === pathname ? currentStep : undefined;
  const scene = step?.pageScene;
  const offer = useStoryOffer(scene && step);
  const setSpokenStep = useSetAtom(spokenStepAtom);
  const stepId = scene && offer ? step.id : undefined;
  const words = spokenWordsOf(scene?.says);
  useEffect(() => {
    if (!stepId) return;
    setSpokenStep({ stepId, words });
    return () => setSpokenStep(null);
  }, [stepId, words, setSpokenStep]);
  const text = scene && offer && spokenTextOf(scene.says, step, offer);
  if (!text) return null;
  return (
    <div className="flex justify-center p-3 pt-4">
      <div data-page-speech="" className="max-w-xl">
        <SpeechBubble
          speaker={scene.speaker}
          side="below"
          footer={<StoryAnswers offer={offer} />}
        >
          {typeof text === "string" ? parseHtml(text) : text}
        </SpeechBubble>
      </div>
    </div>
  );
};
