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
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/localstorage";
import { useActivityDock } from "@/hooks/useActivityDock";
import { storyDockPulseAtom, useStoryGuidance } from "@/hooks/useStoryGuidance";
import { SETTINGS_HREF } from "@/layout/GameSettings";
import Link from "@/layout/Link";
import { LogbookEntry } from "@/layout/Logbook";
import { activityDockRequestAtom, activityDockStateAtom } from "@/libs/activityDock";
import { chatPanelAtom } from "@/libs/chatPanel";
import { type QuestsTabLesson, questsTabLessonAtom } from "@/libs/questsTabLesson";
import { cn } from "@/libs/shadui";
import { getDockAttentionKey } from "@/libs/storyGuidance";
import { isTutorialActive } from "@/libs/tutorial";
import type { UserWithRelations } from "@/routers/profile";
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
    `activityDockOpen:${user?.userId}`,
    isTutorialActive(user),
  );
  const { item: storyItem } = useStoryGuidance();
  // Story news shows in the lesson tab, which a player who turned the tutorial off cannot read.
  const attentionKey =
    isStoryPlayer && user?.tutorialOn !== false
      ? getDockAttentionKey(storyItem)
      : undefined;
  const [seenAttention, setSeenAttention] = useLocalStorage<string | null>(
    `activityDockAttention:${user?.userId}`,
    null,
  );
  const [storedTab, setTab] = useLocalStorage(
    `activityDockTab:${user?.userId}`,
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
  // A lesson waiting on the Quests tab: the tab is marked, shows the lesson's prompt
  // over its quest, and hands back to the lesson once that quest moves on.
  const storedLesson = useAtomValue(questsTabLessonAtom);
  const questsLesson = isTutorialActive(user) ? storedLesson : null;
  const lessonQuest = questsLesson
    ? user?.userQuests?.find((entry) => entry.questId === questsLesson.questId)
    : undefined;
  const lessonProgress = questsLesson
    ? JSON.stringify([
        lessonQuest?.endAt ?? null,
        user?.questData?.find((entry) => entry.id === questsLesson.questId)?.goals ??
          null,
      ])
    : "";
  const progressAtOpen = useRef<string | null>(null);
  useEffect(() => {
    if (!questsLesson || tab !== "quests" || !open) {
      progressAtOpen.current = null;
      return;
    }
    if (progressAtOpen.current === null) {
      progressAtOpen.current = lessonProgress;
    } else if (progressAtOpen.current !== lessonProgress) {
      progressAtOpen.current = null;
      changeTab("tutorial");
    }
  }, [questsLesson, tab, open, lessonProgress, setTab]);
  if (!user && !guided) return null;

  return (
    <aside
      data-activity-dock
      data-battle-focus-layer={lessonShown ? "" : undefined}
      aria-label="Activity"
      className={cn(
        // The lesson's scroll height leaves room for the portrait above the dock. A dock
        // dodging a highlight rises to just below the top bar, and its portrait steps aside.
        "pointer-events-none fixed bottom-24 z-40 max-w-[calc(100vw-2rem)] has-[[data-dodge-highlight=true]]:top-20 has-[[data-dodge-highlight=true]]:bottom-auto md:bottom-5",
        lessonShown && "z-[61]",
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
            isPulsing && "story-pulse-once",
          )}
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
                      tab === "tutorial" &&
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
              value="quests"
              className="mt-0 max-h-[min(55dvh,520px)] overflow-y-auto overscroll-contain rounded-b-xl"
            >
              <ActivityQuests key={user.userId} user={user} lesson={questsLesson} />
            </TabsContent>
          ) : null}
          <TabsContent value="tutorial" className="mt-0">
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
            (isPulsing || hasStoryNews) && "story-pulse-once",
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
}: {
  user: ActivityUser;
  lesson: QuestsTabLesson | null;
}) {
  const [storedPins, setPins] = useLocalStorage<string[]>(
    `activityPinnedQuests:${user.userId}`,
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
  return (
    <div className="space-y-2 p-3">
      {lesson ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/70 bg-amber-500/15 px-3 py-2 text-sm font-semibold">
          <MousePointerClick
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span>{lesson.prompt}</span>
        </p>
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
        className="text-primary inline-block py-2 text-xs underline dark:text-amber-300"
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
  onPin,
}: {
  entry: NonNullable<UserWithRelations>["userQuests"][number];
  tracker: QuestTrackerType;
  pinned: boolean;
  /** The quest a lesson sends the player to: open and outlined. */
  featured?: boolean;
  onPin: () => void;
}) {
  const [expanded, setExpanded] = useState(pinned || featured);
  const id = useId();
  return (
    <article
      className={cn(
        "rounded-lg border",
        pinned && "border-primary/50",
        featured && "border-amber-500 ring-2 ring-amber-500/40",
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
