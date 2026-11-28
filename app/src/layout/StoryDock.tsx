"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { ArrowRight, Check, Circle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  storyPointedIdAtom,
  useStoryGuidance,
  useStoryObjectiveGuidance,
} from "@/hooks/useStoryGuidance";
import LevelUpBtn from "@/layout/LevelUpBtn";
import Link from "@/layout/Link";
import {
  getUsableHighlightElement,
  isSameBox,
  Spotlight,
  type SpotlightBox,
  trackLayout,
} from "@/layout/tutorial/Spotlight";
import { cn } from "@/libs/shadui";
import {
  getExamChecklist,
  getXpSources,
  isLapsedPlayer,
  STORY_SO_FAR,
  type StoryDockItem,
  type StoryXpSource,
} from "@/libs/storyGuidance";
import { showMutationToast } from "@/libs/toast";
import { getTutorialStepPath } from "@/libs/tutorial";
import { parseHtml } from "@/utils/parse";
import { usePublicPathname } from "@/utils/routing";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

/** Story card for the dock: title, Lemu's line and the controls answering it. */
export type StoryDockCard = {
  id: string;
  title: string;
  eyebrow: string;
  lead: React.ReactNode;
  /** The one thing to do now, shown as the card's call to action. */
  action?: string;
  footer?: React.ReactNode;
  /** The card teaches the objective under way, so it comes before the quest itself. */
  leads?: boolean;
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
  const guidance = useStoryObjectiveGuidance();
  const pointedId = useAtomValue(storyPointedIdAtom);
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
  if (item.kind === "chapterActive" && guidance)
    return activeChapterCard(item, guidance, pathname, pointedId);
  return cardFor(item, pathname, user, story.openLeadIds.length);
};

/**
 * Points at the Academy and its Take quest button while the dock does, on a page left lit
 * since the player may go elsewhere. A full story pointer (G3) keeps the hand there; a
 * lighter one (G2) only rings the Academy for a moment.
 */
export const StorySpotlight: React.FC<{
  /** A dialog is open over the page; the Academy's ring waits, a dialog's own control is pointed at. */
  isHidden: boolean;
}> = ({ isHidden }) => {
  const { item } = useStoryGuidance();
  const guidance = useStoryObjectiveGuidance();
  const pathname = usePublicPathname();
  // A chapter waiting at the Academy rings the Academy, and at full guidance its Take
  // quest button; a chapter under way points at the next control towards its objective.
  const pointing =
    item?.kind === "chapterReady" &&
    (item.navigation === "G3" || item.navigation === "G2")
      ? {
          isFull: item.navigation === "G3",
          ids: [
            "tutorial-academy",
            ...(item.navigation === "G3"
              ? [`tutorial-take-quest-${item.questId}`]
              : []),
          ],
        }
      : guidance?.depth.points && guidance.targets.length > 0
        ? {
            isFull: guidance.depth.points === "full",
            // On a phone the menus wait in the game menu, whose button leads to them.
            ids: [
              ...guidance.targets,
              ...(guidance.way?.isInGameMenu ? [GAME_MENU_BUTTON_ID] : []),
            ],
          }
        : undefined;
  // Objective guidance points into an open dialog: what it covers is not a usable target.
  const isPointing = !!pointing && (!isHidden || item?.kind === "chapterActive");
  const isFull = !!pointing?.isFull;
  const idsKey = pointing?.ids.join(",") ?? "";
  const [box, setBox] = useState<SpotlightBox | null>(null);
  const setPointedId = useSetAtom(storyPointedIdAtom);
  const scrolledTo = useRef<string>(undefined);
  useEffect(() => {
    if (!isPointing) return;
    const ids = idsKey.split(",");
    const stop = trackLayout(() => {
      const element = ids.map((id) => getUsableHighlightElement(id)).find(Boolean);
      // A full lesson brings each new target into view once, high enough to stay clear of
      // the dock at the foot of the screen; after that the player scrolls freely.
      const key = element ? `${pathname}:${element.id}` : undefined;
      if (isFull && element && key !== scrolledTo.current) {
        scrolledTo.current = key;
        const rect = element.getBoundingClientRect();
        if (
          !element.closest('[role="dialog"],[role="alertdialog"]') &&
          (rect.top < 64 || rect.bottom > window.innerHeight * 0.55)
        )
          window.scrollBy({
            top: rect.top - window.innerHeight * 0.2,
            behavior: "smooth",
          });
      }
      const rect = element?.getBoundingClientRect();
      const next = rect
        ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        : null;
      setBox((prev) => (prev && next && isSameBox(prev, next) ? prev : next));
      setPointedId(element?.id);
      return element ?? null;
    });
    const timer = isFull
      ? undefined
      : setTimeout(() => {
          stop();
          setBox(null);
        }, LIGHT_POINTER_MS);
    return () => {
      clearTimeout(timer);
      stop();
      setBox(null);
      setPointedId(undefined);
    };
  }, [isPointing, isFull, idsKey, pathname, setPointedId]);
  return box ? <Spotlight box={box} dim={false} pointer={isFull} /> : null;
};

/** The button that opens the game menu on a phone, where the main and location menus wait. */
const GAME_MENU_BUTTON_ID = "tutorial-gameBtn";

/** How long a light story pointer rings its control. */
const LIGHT_POINTER_MS = 4000;

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
          className={cn(badgeVariants({ variant: "outline" }), "min-h-9 text-sm")}
        >
          {source.label}
        </Link>
      </li>
    ))}
  </ul>
);

/** A card footer holding one button that links to where the card's step is done. */
/**
 * The chapter under way, as its navigation level teaches it: the objective and its count,
 * what Lemu says of how it is done, and a way to its page. A Mission Hall quest that counts
 * towards it is taught in its place, and one waiting to be claimed is left to its quest.
 */
const activeChapterCard = (
  item: Extract<StoryDockItem, { questId: string }>,
  guidance: NonNullable<ReturnType<typeof useStoryObjectiveGuidance>>,
  pathname: string,
  /** The control the spotlight found: the game menu's button while that menu is closed. */
  pointedId: string | undefined,
): StoryDockCard => {
  const { focus, depth, way } = guidance;
  const base = {
    id: `story-active-${item.chapter.chapter}`,
    title: item.chapter.title,
    eyebrow: `Chapter ${item.chapter.chapter}`,
  };
  const counted = focus.countsFor?.progress ?? focus.progress;
  const count = counted && (
    <span className="text-muted-foreground whitespace-nowrap">
      {" "}
      ({counted.value}/{counted.target})
    </span>
  );
  if (focus.isClaimable)
    return {
      ...base,
      id: `${base.id}-claim-${focus.questId}`,
      lead: (
        <p className="text-base leading-relaxed">
          <b>{focus.questName}</b> is done. Claim its reward from its quest, then take
          the next one.{count}
        </p>
      ),
      action: "Claim the reward.",
    };
  const guide = depth.explains ? focus.guide : undefined;
  if (!guide)
    return {
      ...base,
      lead: (
        <p className="text-base leading-relaxed">
          Your current objective is under Quests.
        </p>
      ),
    };
  const isOnPage = getTutorialStepPath(guide.page) === pathname;
  return {
    ...base,
    id: `${base.id}-${focus.questId}-${focus.objective.id}`,
    leads: true,
    lead: (
      <div className="space-y-2 text-base leading-relaxed">
        {focus.countsFor ? (
          <p>
            Under way: <b>{focus.questName}</b>
            {count}
          </p>
        ) : (
          focus.objective.description && (
            <p className="italic">
              {parseHtml(focus.objective.description)}
              {count}
            </p>
          )
        )}
        <p>{parseHtml(way?.lead ?? guide.how)}</p>
      </div>
    ),
    action:
      pointedId === GAME_MENU_BUTTON_ID
        ? "Open the game menu in the top right corner."
        : (way?.action ?? guide.action),
    footer:
      depth.linksPage && !isOnPage ? (
        <LinkFooter href={guide.page}>Take me there</LinkFooter>
      ) : undefined,
  };
};

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
