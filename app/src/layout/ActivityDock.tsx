"use client";

import { useAtom, useAtomValue } from "jotai";
import {
  ArrowLeftRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ListChecks,
  MousePointerClick,
  Pin,
  PinOff,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/localstorage";
import {
  characterStorageKey,
  useActivityDock,
  useActivityDockFitWidth,
  useUntaughtModalOpen,
} from "@/hooks/useActivityDock";
import { storyDockPulseAtom, useStoryGuidance } from "@/hooks/useStoryGuidance";
import { SETTINGS_HREF } from "@/layout/GameSettings";
import Link from "@/layout/Link";
import { LogbookEntry } from "@/layout/Logbook";
import { activityDockRequestAtom, activityDockStateAtom } from "@/libs/activityDock";
import { chatPanelAtom } from "@/libs/chatPanel";
import { getQuestsTabLesson, type QuestsTabLesson } from "@/libs/questsTabLesson";
import { cn } from "@/libs/shadui";
import { getDockAttentionKey } from "@/libs/storyGuidance";
import { isTutorialActive } from "@/libs/tutorial";
import { TUTORIAL_STEPS } from "@/libs/tutorialSteps";
import type { UserWithRelations } from "@/routers/profile";
import { usePublicPathname } from "@/utils/routing";
import { capitalizeFirstLetter } from "@/utils/string";
import { useUserDataSelector } from "@/utils/UserContext";
import type { QuestTrackerType } from "@/validators/objectives";

/**
 * A collapsible home for lessons and active quests, opposite the chat launcher. A
 * visitor without a character sees it only during a guided lesson, with the lesson's
 * tab alone.
 */
export function ActivityDock({
  children,
  hiddenLesson,
  guidedLesson,
}: {
  children: ReactNode;
  /** Rendered while the main tutorial's lesson is out of view. */
  hiddenLesson?: ReactNode;
  /**
   * A guided lesson (see `guidedLessonAtom`) is in `children`. It opens on the tutorial
   * tab, even with the main tutorial off, and the player's collapse or tab choice holds
   * for that lesson only; the stored dock state is left as it was. A step that awaits
   * an answer is always shown, over the chat panel too, since the page waits for it.
   */
  guidedLesson?: { id: string; awaitsAnswer: boolean };
}) {
  const { data: user } = useUserDataSelector(selectActivityUser);
  const [chat, setChat] = useAtom(chatPanelAtom);
  const { swapSides, isSideFixed, setSwapSides } = useActivityDock();
  // Students and Genin are still following the story, so the lesson tab leads for them.
  const isStoryPlayer =
    isTutorialActive(user) || user?.rank === "STUDENT" || user?.rank === "GENIN";
  // Only the tutorial keeps the dock open; after it, story news opens it once (below).
  const [storedOpen, setOpen] = useLocalStorage(
    characterStorageKey("activityDockOpen", user?.userId),
    isTutorialActive(user),
  );
  const { item: storyItem } = useStoryGuidance();
  // Story news shows in the lesson tab, which a player who turned the tutorial off cannot read.
  const attentionKey =
    isStoryPlayer && user?.tutorialOn !== false
      ? getDockAttentionKey(storyItem)
      : undefined;
  const [seenAttention, setSeenAttention] = useLocalStorage<string | null>(
    characterStorageKey("activityDockAttention", user?.userId),
    null,
  );
  const [storedTab, setTab] = useLocalStorage(
    characterStorageKey("activityDockTab", user?.userId),
    isStoryPlayer ? "tutorial" : "quests",
  );
  const [guidedView, setGuidedView] = useState<GuidedView | null>(null);
  const guided = guidedLesson
    ? guidedView?.lessonId === guidedLesson.id
      ? guidedView
      : { lessonId: guidedLesson.id, open: true, tab: "tutorial" as const }
    : null;
  const awaitsAnswer = guidedLesson?.awaitsAnswer === true;
  const tab = awaitsAnswer
    ? "tutorial"
    : guided
      ? guided.tab
      : storedTab === "tutorial"
        ? "tutorial"
        : "quests";
  const open =
    awaitsAnswer ||
    ((guided ? guided.open : storedOpen === true) && chat.owner === null);
  const changeOpen = (next: boolean) =>
    guided ? setGuidedView({ ...guided, open: next }) : setOpen(next);
  const changeTab = (next: string) => {
    const value = next === "tutorial" ? "tutorial" : "quests";
    if (guided) setGuidedView({ ...guided, tab: value });
    else setTab(value);
  };
  // The lesson panel is on screen: the main tutorial's, or a guided lesson's.
  const lessonShown =
    open && tab === "tutorial" && (!!guided || user?.tutorialOn !== false);
  // Story progress pulses the dock for a moment instead of opening a dialog.
  const pulse = useAtomValue(storyDockPulseAtom);
  const [isPulsing, setIsPulsing] = useState(false);
  useEffect(() => {
    if (pulse === 0) return;
    setIsPulsing(true);
    const timer = setTimeout(() => setIsPulsing(false), 4000);
    return () => clearTimeout(timer);
  }, [pulse]);
  const panelId = useId();
  // A chapter waiting at the Academy, or the Chunin Exams, opens the dock once. On a
  // phone the open dock would cover the page, so the collapsed button is marked instead.
  const hasStoryNews = !!attentionKey && attentionKey !== seenAttention;
  useEffect(() => {
    if (!attentionKey || attentionKey === seenAttention) return;
    if (window.matchMedia(PHONE_QUERY).matches) return;
    setSeenAttention(attentionKey);
    setTab("tutorial");
    setOpen(true);
  }, [attentionKey, seenAttention, setSeenAttention, setOpen, setTab]);
  const previousTutorialOn = useRef(user?.tutorialOn);
  useEffect(() => {
    // Re-enabling lessons in Settings must also reveal them in a collapsed dock.
    if (previousTutorialOn.current === false && user?.tutorialOn === true) {
      setTab("tutorial");
      setOpen(true);
    }
    previousTutorialOn.current = user?.tutorialOn;
  }, [user?.tutorialOn, setOpen, setTab]);
  // A lesson waiting on the Quests tab: the tab leads with its quest, marks as much as
  // the lesson asks, and hands back to the lesson once that quest moves on.
  const questsLesson = getQuestsTabLesson(user);
  const lessonQuest = questsLesson
    ? user?.userQuests?.find((entry) => entry.questId === questsLesson.questId)
    : undefined;
  const tutorialStep = user?.tutorialStep ?? 0;
  const isTutorialRunning = isTutorialActive(user);
  const lessonStep = isTutorialRunning ? TUTORIAL_STEPS[tutorialStep] : undefined;
  // An answer moves the step on, so a lesson waiting for one hands back only then: a
  // reward claimed meanwhile rewrites the quest's tracker, not the lesson's progress.
  const awaitsQuestsAnswer = !!questsLesson && lessonStep?.advanceOn === "questDialog";
  const lessonProgress =
    questsLesson && !awaitsQuestsAnswer
      ? JSON.stringify([
          lessonQuest?.endAt ?? null,
          user?.questData?.find((entry) => entry.id === questsLesson.questId)?.goals ??
            null,
        ])
      : "";
  // While Quests is showing, a new step or progress on the lesson's quest returns the
  // dock to the lesson; a collapsed dock reopens on it too. A new step that is itself
  // answered here keeps the tab, now showing its marks.
  const seenOnQuests = useRef<{ step: number; progress: string } | null>(null);
  useEffect(() => {
    if (guided || tab !== "quests" || !isTutorialRunning) {
      seenOnQuests.current = null;
      return;
    }
    const seen = seenOnQuests.current;
    if (!seen || (seen.step !== tutorialStep && questsLesson)) {
      seenOnQuests.current = { step: tutorialStep, progress: lessonProgress };
      return;
    }
    if (
      seen.step !== tutorialStep ||
      (questsLesson && seen.progress !== lessonProgress)
    ) {
      seenOnQuests.current = null;
      changeTab("tutorial");
    }
  }, [
    guided,
    tab,
    tutorialStep,
    lessonProgress,
    questsLesson,
    isTutorialRunning,
    setTab,
  ]);
  // A lesson sits above the page's dim and the dialogs it teaches, but below any other
  // modal; the Story tab after the tutorial stays with the page.
  const dockRef = useRef<HTMLElement>(null);
  // On the fight page a lesson points at the battle alone (Continue once it is won).
  const isOnCombatPage = usePublicPathname() === "/combat";
  const isLessonRaised = lessonShown && (!!guided || isTutorialRunning);
  const isUnderModal = useUntaughtModalOpen(
    dockRef,
    isLessonRaised && !guided,
    lessonStep?.elementIds,
  );
  const fitWidth = useActivityDockFitWidth(dockRef, open, swapSides);
  // During a lesson the Quests tab takes the lesson's height on a phone, so switching
  // tabs leaves the bottom-anchored dock's tab bar where it was.
  const lessonPanelRef = useRef<HTMLDivElement>(null);
  const questsPanelRef = useRef<HTMLDivElement>(null);
  const [lessonHeight, setLessonHeight] = useState<number | null>(null);
  useEffect(() => {
    const panel = lessonPanelRef.current;
    if (!isLessonRaised || !panel) return;
    const measure = () => {
      if (panel.offsetHeight > 0) setLessonHeight(panel.offsetHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [isLessonRaised]);
  if (!user && !guided) return null;

  return (
    <aside
      ref={dockRef}
      data-activity-dock
      data-battle-focus-layer={lessonShown ? "" : undefined}
      aria-label="Activity"
      className={cn(
        // The lesson's scroll height leaves room for the portrait above the dock. A dock
        // dodging a highlight rises to just below the top bar, and its portrait steps aside.
        "pointer-events-none fixed bottom-24 z-40 max-w-[calc(100vw-2rem)] has-[[data-dodge-highlight=true]]:top-[var(--activity-dock-dodge-top,5rem)] has-[[data-dodge-highlight=true]]:bottom-auto md:bottom-5",
        isLessonRaised && !isUnderModal && "z-[61]",
        swapSides ? "right-4 md:right-5" : "left-4 md:left-5",
      )}
    >
      {open ? (
        // A tutorial fight narrows the dock to the space beside the battlefield, where
        // its tabs keep only their icons.
        <Tabs
          value={tab}
          onValueChange={changeTab}
          id={panelId}
          className={cn(
            "border-primary/60 bg-card text-card-foreground @container/dock pointer-events-auto relative w-[var(--activity-dock-width,420px)] max-w-[calc(100vw-2rem)] rounded-xl border-2 shadow-xl",
            isPulsing && ATTENTION_PULSE,
          )}
          style={
            fitWidth === null
              ? undefined
              : { width: `min(var(--activity-dock-width, 420px), ${fitWidth}px)` }
          }
        >
          <header className="bg-card relative z-10 flex items-center gap-1 rounded-t-[calc(var(--radius)-2px)] border-b px-2 py-1.5">
            <TabsList
              aria-label="Activity"
              className="h-auto w-auto flex-1 justify-start bg-transparent p-0"
            >
              {(user ? DOCK_TABS : GUEST_TABS).map((value) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  id={value === "quests" ? "tutorial-activity-quests" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-1.5 px-2 data-[state=active]:font-semibold",
                    value === "quests" &&
                      questsLesson &&
                      questsLesson.marks !== "none" &&
                      tab === "tutorial" &&
                      !isOnCombatPage &&
                      "animate-pulse bg-amber-500/20 ring-2 ring-amber-500",
                  )}
                >
                  {value === "tutorial" ? (
                    <BookOpen className="h-4 w-4" />
                  ) : (
                    <ListChecks className="h-4 w-4" />
                  )}
                  <span className="@max-[17rem]/dock:sr-only">
                    {value === "tutorial" && !isTutorialActive(user)
                      ? "Story"
                      : capitalizeFirstLetter(value)}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
            {!isSideFixed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                aria-label="Swap Chat and Activity sides"
                title="Swap Chat and Activity sides"
                onClick={() => setSwapSides(!swapSides)}
              >
                <ArrowLeftRight className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label="Collapse Activity"
              onClick={() => {
                changeOpen(false);
                if (document.documentElement.dataset.mobileActivityNav === "true") {
                  document
                    .querySelector<HTMLButtonElement>("[data-mobile-activity-trigger]")
                    ?.focus();
                }
              }}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </header>
          {user ? (
            <TabsContent
              ref={questsPanelRef}
              value="quests"
              className={cn(
                "mt-0 max-h-[min(55dvh,520px)] overflow-y-auto overscroll-contain rounded-b-xl",
                // A narrow dock reads like its lesson: body text 13.5px, labels 10.5px.
                "@max-[34rem]/dock:[&_.text-sm]:text-lg @max-[34rem]/dock:[&_.text-xs]:text-sm",
                // A short lesson still leaves the list room to read.
                lessonHeight !== null &&
                  isTutorialRunning &&
                  "max-md:h-[max(var(--activity-dock-lesson-height),16rem)]",
              )}
              style={
                lessonHeight === null
                  ? undefined
                  : ({
                      "--activity-dock-lesson-height": `${lessonHeight}px`,
                    } as CSSProperties)
              }
            >
              <ActivityQuests
                key={user.userId}
                user={user}
                lesson={questsLesson}
                awaitsAnswer={awaitsQuestsAnswer}
                scrollerRef={questsPanelRef}
              />
            </TabsContent>
          ) : null}
          <TabsContent ref={lessonPanelRef} value="tutorial" className="mt-0">
            {user?.tutorialOn === false && !guided ? (
              <p className="text-muted-foreground p-4 text-sm">
                Tutorial is off.{" "}
                <Link
                  className="text-primary underline dark:text-amber-300"
                  href={`${SETTINGS_HREF}&settings=help&setting=tutorial`}
                >
                  Open tutorial settings
                </Link>
                .
              </p>
            ) : (
              children
            )}
          </TabsContent>
        </Tabs>
      ) : (
        <Button
          variant="outline"
          className={cn(
            "bg-card pointer-events-auto h-11 gap-2 rounded-full shadow-lg",
            (isPulsing || hasStoryNews) && ATTENTION_PULSE,
          )}
          aria-expanded={false}
          aria-controls={panelId}
          aria-label="Open Activity"
          onClick={() => {
            setChat((current) => ({ ...current, owner: null, openRequested: false }));
            if (hasStoryNews && attentionKey) {
              setSeenAttention(attentionKey);
              changeTab("tutorial");
            }
            changeOpen(true);
          }}
        >
          <ListChecks className="h-4 w-4" />
          {hasStoryNews ? "Story news" : "Activity"}
          {hasStoryNews && (
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          )}
        </Button>
      )}
      {!(open && tab === "tutorial" && !guided) && hiddenLesson}
    </aside>
  );
}

/** Below Tailwind's md breakpoint the dock would cover most of the page when open. */
const PHONE_QUERY = "(max-width: 767px)";

function ActivityQuests({
  user,
  lesson,
  awaitsAnswer,
  scrollerRef,
}: {
  user: ActivityUser;
  lesson: QuestsTabLesson | null;
  /** The lesson waits for an answer here, which is scrolled into view once shown. */
  awaitsAnswer: boolean;
  scrollerRef: RefObject<HTMLDivElement | null>;
}) {
  // Each answer the lesson waits for is brought into view once, when it appears; the
  // player's own scrolling is left alone after that.
  const shownAnswers = useRef<Element | null>(null);
  useEffect(() => {
    const scroller = scrollerRef.current;
    const answers = awaitsAnswer
      ? scroller?.querySelector("#tutorial-dialog-options")
      : null;
    if (!scroller || !answers || answers === shownAnswers.current) return;
    shownAnswers.current = answers;
    const overflow =
      answers.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom;
    if (overflow > 0) scroller.scrollTop += overflow;
  });
  const [storedPins, setPins] = useLocalStorage<string[]>(
    characterStorageKey("activityPinnedQuests", user.userId),
    [],
  );
  const pins = Array.isArray(storedPins)
    ? storedPins.filter((id) => typeof id === "string")
    : [];
  const quests = (user.userQuests ?? []).filter(
    (entry) => !entry.endAt && entry.quest.questType !== "achievement",
  );
  // The lesson's quest leads, then pinned quests.
  const rank = (entry: (typeof quests)[number]) =>
    (entry.questId === lesson?.questId ? 2 : 0) + Number(pins.includes(entry.id));
  const ordered = [...quests].sort((a, b) => rank(b) - rank(a));
  // A lesson that sends the player here says what to do, as a callout only the first time.
  return (
    <div className="space-y-2 p-3">
      {lesson?.marks === "all" ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/70 bg-amber-500/15 px-3 py-2 text-sm font-semibold">
          <MousePointerClick
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span>{lesson.prompt}</span>
        </p>
      ) : lesson ? (
        <p className="text-sm font-semibold">{lesson.prompt}</p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Pin the objectives you want to keep at the top.
        </p>
      )}
      {ordered.map((entry) => {
        const tracker = user.questData?.find((item) => item.id === entry.questId);
        const pinned = pins.includes(entry.id);
        return (
          tracker && (
            <ActivityQuest
              key={`${entry.id}-${entry.questId === lesson?.questId}`}
              entry={entry}
              tracker={tracker}
              pinned={pinned}
              featured={entry.questId === lesson?.questId}
              outlined={entry.questId === lesson?.questId && lesson.marks === "all"}
              onPin={() =>
                setPins(
                  pinned
                    ? pins.filter((id) => id !== entry.id)
                    : [
                        ...pins.filter((id) => quests.some((quest) => quest.id === id)),
                        entry.id,
                      ],
                )
              }
            />
          )
        );
      })}
      {quests.length === 0 && (
        <p className="text-muted-foreground py-4 text-sm">
          No active quests or missions.
        </p>
      )}
      <Link
        href="/profile"
        className="text-primary inline-block py-2 text-sm underline dark:text-amber-300"
      >
        Profile &amp; logbook
      </Link>
    </div>
  );
}

function ActivityQuest({
  entry,
  tracker,
  pinned,
  featured = false,
  outlined = false,
  onPin,
}: {
  entry: NonNullable<UserWithRelations>["userQuests"][number];
  tracker: QuestTrackerType;
  pinned: boolean;
  /** The quest a lesson sends the player to: open. */
  featured?: boolean;
  /** Ringed, for the first lesson on this tab. */
  outlined?: boolean;
  onPin: () => void;
}) {
  const [expanded, setExpanded] = useState(pinned || featured);
  const id = useId();
  return (
    <article
      className={cn(
        "rounded-lg border",
        pinned && "border-primary/50",
        outlined && "border-amber-500 ring-2 ring-amber-500/40",
      )}
    >
      <div className="flex items-center p-1">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          className="flex min-w-0 flex-1 items-center gap-1 p-2 text-left"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0" />
          )}
          <span className="min-w-0">
            <span className="text-muted-foreground block text-xs">
              {capitalizeFirstLetter(entry.quest.questType)}
            </span>
            <span className="block text-sm font-semibold">{entry.quest.name}</span>
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${pinned ? "Unpin" : "Pin"} ${entry.quest.name}`}
          aria-pressed={pinned}
          onClick={() => {
            onPin();
            if (!pinned) setExpanded(true);
          }}
        >
          {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
        </Button>
      </div>
      {expanded && (
        <div id={id} className="border-t p-2 text-sm">
          <LogbookEntry userQuest={entry} tracker={tracker} hideTitle compact />
        </div>
      )}
    </article>
  );
}

const DOCK_TABS = ["tutorial", "quests"] as const;
/** A visitor has no quests; the dock holds the guided lesson alone. */
const GUEST_TABS = ["tutorial"] as const;

/** The dock follows lessons and quests, not money, pools or movement. */
const selectActivityUser = (user: NonNullable<UserWithRelations>) => ({
  userId: user.userId,
  tutorialOn: user.tutorialOn,
  tutorialStep: user.tutorialStep,
  rank: user.rank,
  userQuests: user.userQuests,
  questData: user.questData,
});

type ActivityUser = ReturnType<typeof selectActivityUser>;

/** The dock's open state and tab during one guided lesson. */
type GuidedView = { lessonId: string; open: boolean; tab: "tutorial" | "quests" };

/** The call-to-action pulse, for three beats: news the player may leave for later. */
const ATTENTION_PULSE =
  "motion-safe:animate-cta-pulse motion-safe:[animation-iteration-count:3]";
