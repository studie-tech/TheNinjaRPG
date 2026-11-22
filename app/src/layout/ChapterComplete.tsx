"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BlacksteelChapter } from "@/drizzle/constants";
import { useStoryGuidance } from "@/hooks/useStoryGuidance";
import {
  getChapterClosingQuestId,
  getChapterReward,
  getChapterTeaser,
  getChapterUnlocks,
  STORY_SO_FAR,
} from "@/libs/storyGuidance";

/**
 * Celebrates a finished story chapter with a card: what the chapter revealed, its
 * rewards in whole numbers, the systems the next chapter opens and a line about it.
 * Only chapters finished while the page is open count, so a reload never replays it.
 */
export const ChapterCompleteWatcher: React.FC = () => {
  const { user, story } = useStoryGuidance();
  const seen = useRef<Set<number> | null>(null);
  // Rewards come from the quest row, which leaves the active list once it is claimed.
  const rewards = useRef(new Map<string, ChapterRewardSource>());
  const [shown, setShown] = useState<{
    chapter: BlacksteelChapter;
    reward: string[];
  } | null>(null);
  const userQuests = user?.userQuests;
  useEffect(() => {
    for (const entry of userQuests ?? []) {
      if ("quest" in entry && entry.quest) {
        rewards.current.set(entry.questId, entry.quest.content.reward);
      }
    }
  }, [userQuests]);
  const finished = story?.finishedChapters;
  const finishedKey = finished?.map((chapter) => chapter.chapter).join(",");
  useEffect(() => {
    if (!finished) return;
    const current = new Set(finished.map((chapter) => chapter.chapter));
    if (!seen.current) {
      seen.current = current;
      return;
    }
    const fresh = finished.find((chapter) => !seen.current?.has(chapter.chapter));
    seen.current = current;
    if (fresh) {
      setShown({
        chapter: fresh,
        reward: getChapterReward(
          rewards.current.get(getChapterClosingQuestId(fresh)) ?? null,
        ),
      });
    }
  }, [finishedKey]);
  if (!shown) return null;
  const { reward } = shown;
  const unlocks = getChapterUnlocks(shown.chapter.chapter);
  return (
    <Dialog open onOpenChange={(open) => !open && setShown(null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            Chapter {shown.chapter.chapter} complete
          </p>
          <DialogTitle>{shown.chapter.title}</DialogTitle>
          <DialogDescription className="text-base italic">
            {STORY_SO_FAR[shown.chapter.chapter]}
          </DialogDescription>
        </DialogHeader>
        {reward.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Rewards">
            {reward.map((label) => (
              <li
                key={label}
                className="rounded-full border px-3 py-1 font-semibold text-sm"
              >
                {label}
              </li>
            ))}
          </ul>
        )}
        {unlocks.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Sparkles aria-hidden className="h-4 w-4 text-amber-500" />
            <span>Chapter {shown.chapter.chapter + 1} opens:</span>
            {unlocks.map((label) => (
              <span
                key={label}
                className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-600 dark:text-amber-300"
              >
                {label}
              </span>
            ))}
          </div>
        )}
        <p className="text-muted-foreground text-sm">
          {getChapterTeaser(shown.chapter.chapter, user?.level)}
        </p>
        <DialogFooter>
          <Button size="lg" onClick={() => setShown(null)}>
            Continue <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

type ChapterRewardSource = Parameters<typeof getChapterReward>[0];
