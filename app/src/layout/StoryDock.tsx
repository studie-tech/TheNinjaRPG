"use client";

import { ArrowRight, Check, Circle } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useStoryGuidance } from "@/hooks/useStoryGuidance";
import LevelUpBtn from "@/layout/LevelUpBtn";
import Link from "@/layout/Link";
import {
  getExamChecklist,
  getXpSources,
  isLapsedPlayer,
  STORY_SO_FAR,
  type StoryDockItem,
  type StoryXpSource,
} from "@/libs/storyGuidance";
import { showMutationToast } from "@/libs/toast";
import { usePublicPathname } from "@/utils/routing";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

/** Story card for the dock: title, Lemu's line and the controls answering it. */
export type StoryDockCard = {
  id: string;
  title: string;
  eyebrow: string;
  lead: React.ReactNode;
  footer?: React.ReactNode;
};

/**
 * What the dock says once the Academy Trials are over. Quests the player is already
 * working on are shown by the dock itself; this card covers the rest, so the dock is
 * never empty: a waiting level-up, the next chapter to pick up, progress towards the
 * next chapter's level, the Chunin Exams milestone, or the best experience today.
 * Story pointers fade with the chapter's navigation level and the guidance setting.
 */
export const useStoryDockCard = (): StoryDockCard | null => {
  const { user, item, story } = useStoryGuidance();
  const pathname = usePublicPathname();
  const recap = useLapsedRecap(user?.userId, user?.lastActiveAt);
  useChapterUnlockToast(item);
  if (!user || !item || !story) return null;
  if (recap && story.finishedChapters.length > 0) {
    const last = story.finishedChapters[story.finishedChapters.length - 1];
    return {
      id: "story-recap",
      title: "Story so far",
      eyebrow: "Welcome back",
      lead: (
        <div className="space-y-2 text-base leading-relaxed">
          <p>Good to see you again. Here is where the case stands:</p>
          {last && <p className="italic">{STORY_SO_FAR[last.chapter]}</p>}
        </div>
      ),
      footer: (
        <div className="flex justify-end">
          <Button size="lg" onClick={recap.dismiss}>
            Continue <ArrowRight className="ml-2 h-5 w-5" />
          </Button>
        </div>
      ),
    };
  }
  return cardFor(item, pathname, user, story.openLeadIds.length);
};

/**
 * Spotlights the Academy and its Take quest button while the dock points there.
 * A full story pointer (G3) keeps the ring on; a lighter one (G2) pulses it once.
 */
export const StorySpotlight: React.FC = () => {
  const { item } = useStoryGuidance();
  const pathname = usePublicPathname();
  const target =
    item?.kind === "chapterReady" &&
    (item.navigation === "G3" || item.navigation === "G2")
      ? item
      : null;
  useEffect(() => {
    if (!target) return;
    const ids =
      target.navigation === "G3"
        ? ["tutorial-academy", `tutorial-take-quest-${target.questId}`]
        : ["tutorial-academy"];
    const classes =
      target.navigation === "G3"
        ? ["ring-4", "ring-amber-400", "rounded-lg", "animate-pulse"]
        : ["ring-4", "ring-amber-400", "rounded-lg", "story-pulse-once"];
    const marked: HTMLElement[] = [];
    const apply = () => {
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element && !marked.includes(element)) {
          element.classList.add(...classes);
          marked.push(element);
        }
      }
    };
    apply();
    // Pages render their buildings after the profile; look again until they exist.
    const interval = setInterval(apply, 1000);
    return () => {
      clearInterval(interval);
      for (const element of marked) element.classList.remove(...classes);
    };
  }, [target?.questId, target?.navigation, pathname]);
  return null;
};

const cardFor = (
  item: StoryDockItem,
  pathname: string,
  user: NonNullable<ReturnType<typeof useStoryGuidance>["user"]>,
  openLeads: number,
): StoryDockCard | null => {
  switch (item.kind) {
    case "levelUp":
      return {
        id: "story-level-up",
        title: `Level ${item.level} is ready`,
        eyebrow: "Level up",
        lead: (
          <p className="text-base leading-relaxed">
            Your experience covers the next level. Levelling up raises your health,
            chakra and stamina, and opens new chapters.
          </p>
        ),
        footer: (
          <div className="flex justify-end">
            <LevelUpBtn className="" />
          </div>
        ),
      };
    case "assignXp":
      return {
        id: "story-assign-xp",
        title: "Experience to spend",
        eyebrow: "Level up",
        lead: (
          <p className="text-base leading-relaxed">
            You have {item.experience.toLocaleString()} unassigned experience, enough to
            level up. Choose the stats it goes into, then take the level.
          </p>
        ),
        footer: <LinkFooter href="/profile/experience">Assign XP</LinkFooter>,
      };
    case "exam":
    case "examActive":
      return {
        id: "story-exam",
        title: "The Chunin Exams",
        eyebrow: "Milestone",
        lead: (
          <div className="space-y-2">
            <p className="text-base leading-relaxed">
              {item.kind === "exam"
                ? "The Chunin Exams are open at the Academy. Prepare well: the first test is a quiz on combat tags, and a wrong answer sends you back to the start."
                : "You are sitting the Chunin Exams. Take your time with each test."}
            </p>
            <ul className="space-y-1 text-sm">
              {getExamChecklist(user).map((entry) => (
                <li key={entry.label} className="flex items-center gap-2">
                  {entry.done ? (
                    <Check aria-hidden className="h-4 w-4 text-green-500" />
                  ) : (
                    <Circle aria-hidden className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className={entry.done ? "text-muted-foreground" : ""}>
                    {entry.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ),
        footer:
          item.kind === "exam" && pathname !== "/academy" ? (
            <LinkFooter href="/academy">Go to the Academy</LinkFooter>
          ) : undefined,
      };
    case "chapterReady": {
      const eyebrow = `Chapter ${item.chapter.chapter} · ${item.chapter.title}`;
      if (item.navigation === "G0") {
        return dailyCard(
          "Chapter ready",
          `A new chapter is marked New at the Academy. Until you pick it up:`,
          getXpSources(user, openLeads),
        );
      }
      const showButton =
        (item.navigation === "G3" || item.navigation === "G2") &&
        pathname !== "/academy";
      const isAtAcademy = pathname === "/academy";
      return {
        id: `story-ready-${item.chapter.chapter}`,
        title: item.chapter.chapter === 8 ? "Lemu is waiting" : "A new chapter",
        eyebrow,
        lead: (
          <p className="text-base leading-relaxed">
            {item.chapter.chapter === 8
              ? "Remember the shard the masked courier dropped? Someone at the Academy archives wants to see you about it. "
              : `Chapter ${item.chapter.chapter} is ready at the Academy. `}
            {item.navigation === "G3"
              ? isAtAcademy
                ? "Open the highlighted chapter and tap Take quest."
                : "New story always starts at the Academy."
              : item.navigation === "G2"
                ? "Pick it up whenever you are ready."
                : "Head there whenever you are ready."}
          </p>
        ),
        footer: showButton ? (
          <LinkFooter href="/academy">Take me there</LinkFooter>
        ) : undefined,
      };
    }
    case "chapterActive":
      return {
        id: `story-active-${item.chapter.chapter}`,
        title: item.chapter.title,
        eyebrow: `Chapter ${item.chapter.chapter}`,
        lead: (
          <p className="text-base leading-relaxed">
            Your current objective is under Quests.
          </p>
        ),
      };
    case "nextChapter":
      return {
        id: `story-next-${item.chapter.chapter}`,
        title: `Chapter ${item.chapter.chapter} at level ${item.chapter.level}`,
        eyebrow: `Next · ${item.chapter.title}`,
        lead: (
          <div className="space-y-2">
            <Progress
              value={Math.round(item.progress * 100)}
              aria-label={`Progress to level ${item.chapter.level}`}
            />
            <p className="text-sm text-muted-foreground">
              {item.xpToGo.toLocaleString()} experience to go. Good ways to earn it:
            </p>
            <SourceChips sources={item.sources} />
          </div>
        ),
      };
    case "daily":
      return dailyCard("Today", "Good ways to grow stronger today:", item.sources);
  }
};

const dailyCard = (
  eyebrow: string,
  text: string,
  sources: StoryXpSource[],
): StoryDockCard => ({
  id: `story-daily-${eyebrow}`,
  title: "Keep training",
  eyebrow,
  lead: (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{text}</p>
      <SourceChips sources={sources} />
    </div>
  ),
});

const SourceChips: React.FC<{ sources: StoryXpSource[] }> = ({ sources }) => (
  <ul className="flex flex-wrap gap-2">
    {sources.map((source) => (
      <li key={source.id}>
        <Link
          href={source.href}
          className="inline-flex min-h-9 items-center rounded-full border border-amber-500/50 bg-amber-500/10 px-3 text-sm hover:bg-amber-500/20"
        >
          {source.label}
        </Link>
      </li>
    ))}
  </ul>
);

/** A card footer holding one button that links to where the card's step is done. */
const LinkFooter: React.FC<{ href: string; children: React.ReactNode }> = ({
  href,
  children,
}) => (
  <div className="flex justify-end">
    <Button asChild size="lg">
      <Link href={href}>
        {children} <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />
      </Link>
    </Button>
  </div>
);

/**
 * A "Story so far" card for a player back after a week or more. Absence is measured
 * on this device, since the server's activity time is refreshed by the visit itself.
 */
const useLapsedRecap = (
  userId: string | undefined,
  lastActiveAt: Date | string | null | undefined,
) => {
  const [isLapsed, setIsLapsed] = useState(false);
  useEffect(() => {
    if (!userId) return;
    const key = `story-last-visit:${userId}`;
    const previous = safeLocalStorageGetItem(key);
    if (!safeLocalStorageSetItem(key, new Date().toISOString())) return;
    if (isLapsedPlayer(previous) && lastActiveAt) setIsLapsed(true);
  }, [userId]);
  return isLapsed ? { dismiss: () => setIsLapsed(false) } : null;
};

/** One toast when a chapter unlocks, so even a player with no pointers learns of it. */
const useChapterUnlockToast = (item: StoryDockItem | null) => {
  const chapter = item?.kind === "chapterReady" ? item.chapter.chapter : undefined;
  useEffect(() => {
    if (!chapter) return;
    const key = `story-unlock-toast:${chapter}`;
    if (safeLocalStorageGetItem(key) || !safeLocalStorageSetItem(key, "1")) return;
    showMutationToast({
      success: true,
      message: `New: Chapter ${chapter} is ready at the Academy`,
    });
  }, [chapter]);
};
