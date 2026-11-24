"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/localstorage";
import {
  characterStorageKey,
  useActivityDock,
  useActivityDockFit,
  useUntaughtModalOpen,
} from "@/hooks/useActivityDock";
import { storyDockPulseAtom, useStoryGuidance } from "@/hooks/useStoryGuidance";
import { SETTINGS_HREF } from "@/layout/GameSettings";
import Link from "@/layout/Link";
import { LogbookEntry } from "@/layout/Logbook";
import { DockHighlight } from "@/layout/tutorial/DockHighlight";
import { activityDockPlaceAtom, type DockPlace } from "@/layout/tutorial/dockPlacement";
import {
  isSameBox,
  Spotlight,
  type SpotlightBox,
  type SpotlightMark,
  trackLayout,
} from "@/layout/tutorial/Spotlight";
import { activityDockRequestAtom, activityDockStateAtom } from "@/libs/activityDock";
import { chatPanelAtom } from "@/libs/chatPanel";
import { getQuestsTabLesson, type QuestsTabLesson } from "@/libs/questsTabLesson";
import { cn } from "@/libs/shadui";
import { getDockAttentionKey } from "@/libs/storyGuidance";
import {
  isTutorialActive,
  isUsableHighlightRect,
  TUTORIAL_ANY_PAGE,
  TUTORIAL_LAYOUT_EVENT,
} from "@/libs/tutorial";
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
  const request = useAtomValue(activityDockRequestAtom);
  const reportState = useSetAtom(activityDockStateAtom);
  const previousRequest = useRef(request.sequence);
  const focusRequested = useRef(false);
  useEffect(() => {
    reportState({
      userId: user?.userId ?? null,
      panelId,
      open,
      hasNews: !open && hasStoryNews,
    });
  }, [user?.userId, panelId, open, hasStoryNews, reportState]);
  useEffect(
    () => () => {
      reportState({ userId: null, panelId: null, open: false, hasNews: false });
    },
    [reportState],
  );
  useEffect(() => {
    if (previousRequest.current === request.sequence) return;
    previousRequest.current = request.sequence;
    if (!user || request.userId !== user.userId) return;
    focusRequested.current = request.open;
    if (request.open) {
      setChat((current) => ({ ...current, owner: null, openRequested: false }));
      // Opened for its news, it shows the news.
      if (hasStoryNews && attentionKey) {
        setSeenAttention(attentionKey);
        changeTab("tutorial");
      }
    }
    changeOpen(request.open);
  }, [request, user, changeOpen, setChat, hasStoryNews, attentionKey]);
  useEffect(() => {
    if (!open || !focusRequested.current) return;
    const activeTab = document
      .getElementById(panelId)
      ?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    if (activeTab) {
      focusRequested.current = false;
      activeTab.focus();
    }
  }, [open, panelId, tab, request.sequence]);
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
  const lessonProgress = questsLesson
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
  const pathname = usePublicPathname();
  const isLessonRaised = lessonShown && (!!guided || isTutorialRunning);
  // A lesson on the Quests tab leads there from its own page: a fight's close, the
  // hospital and the way to that page each point at controls of their own.
  const leadsToQuests =
    open &&
    !guided &&
    !!questsLesson &&
    !!lessonQuest &&
    pathname !== "/combat" &&
    user?.status !== "HOSPITALIZED" &&
    (lessonStep?.page === TUTORIAL_ANY_PAGE || lessonStep?.page === pathname);
  const isUnderModal = useUntaughtModalOpen(
    dockRef,
    (isLessonRaised && !guided) || leadsToQuests,
    lessonStep?.elementIds,
  );
  const isQuestsTabMarked = leadsToQuests && lessonShown && !isUnderModal;
  const fit = useActivityDockFit(
    dockRef,
    open,
    swapSides,
    isTutorialRunning && !guided,
  );
  // A lesson about a control stands beside it, and the Quests tab where the lesson stood.
  const [lessonPlace, setLessonPlace] = useAtom(activityDockPlaceAtom);
  useEffect(() => () => setLessonPlace(null), [setLessonPlace]);
  const isPlaced = open && isTutorialRunning && !guided;
  const place = !isPlaced
    ? null
    : lessonShown
      ? lessonPlace
      : lessonPlace && {
          ...lessonPlace,
          top: Math.max(
            0,
            Math.min(lessonPlace.top, window.innerHeight - QUESTS_MIN_HEIGHT_PX),
          ),
        };
  useDockGlide(dockRef, place);
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
        "pointer-events-none fixed z-40 max-w-[calc(100vw-2rem)]",
        isLessonRaised && !isUnderModal && "z-[61]",
        place
          ? "top-0 left-0"
          : "bottom-24 has-[[data-dodge-highlight=true]]:top-[var(--activity-dock-dodge-top,5rem)] has-[[data-dodge-highlight=true]]:bottom-auto md:bottom-[var(--activity-dock-bottom,1.25rem)]",
        !place &&
          (swapSides
            ? "right-4 md:right-[var(--activity-dock-edge,1.25rem)]"
            : "left-4 md:left-[var(--activity-dock-edge,1.25rem)]"),
        // A dock over a dialog moves to the side where it covers none of its controls.
        !place &&
          "has-[[data-dodge-side=left]]:right-auto has-[[data-dodge-side=left]]:left-4 has-[[data-dodge-side=right]]:right-4 has-[[data-dodge-side=right]]:left-auto md:has-[[data-dodge-side=left]]:left-5 md:has-[[data-dodge-side=right]]:right-5",
      )}
      style={
        place
          ? ({
              transform: `translate(${place.left}px, ${place.top}px)`,
              "--activity-dock-top": `${place.top}px`,
            } as CSSProperties)
          : fit.edge === null || !open
            ? undefined
            : ({ "--activity-dock-edge": `${fit.edge}px` } as CSSProperties)
      }
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
            place
              ? { width: place.width }
              : fit.width === null
                ? undefined
                : { width: `min(var(--activity-dock-width, 420px), ${fit.width}px)` }
          }
        >
          <header className="bg-card relative z-10 flex items-center gap-1 rounded-t-[calc(var(--radius)-2px)] border-b px-2 py-1.5">
            <TabsList
              aria-label="Activity"
              className="h-auto w-auto flex-1 justify-start gap-2 bg-transparent p-0"
            >
              {(user ? DOCK_TABS : GUEST_TABS).map((value) => (
                <DockHighlight
                  key={value}
                  active={value === "quests" && isQuestsTabMarked}
                  pointerClassName="left-1/2 -ml-6"
                >
                  <TabsTrigger
                    value={value}
                    id={value === "quests" ? "tutorial-activity-quests" : undefined}
                    className="flex h-9 items-center gap-1.5 px-2 data-[state=active]:font-semibold"
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
                </DockHighlight>
              ))}
            </TabsList>
            {!isSideFixed && !place && (
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
                "mt-0 max-h-[min(55dvh,520px,calc(100dvh-var(--activity-dock-top,0px)-5rem))] overflow-y-auto overscroll-contain rounded-b-xl",
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
                isControlMarked={leadsToQuests && tab === "quests" && !isUnderModal}
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
            // Guests and compact frames without a visible mobile bar keep a launcher.
            user && "[[data-mobile-activity-nav=true]_&]:hidden",
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

/**
 * Glides the dock to a new place beside its subject, so the eye can follow it there. Back at
 * its resting place, where the page is placed around it, it stands at once.
 */
const useDockGlide = (
  dockRef: RefObject<HTMLElement | null>,
  place: DockPlace | null,
) => {
  const placeKey = place && `${place.left},${place.top}`;
  const lastBox = useRef<DOMRect | null>(null);
  const glide = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    glide.current?.cancel();
    glide.current = null;
    const box = dock.getBoundingClientRect();
    const from = lastBox.current;
    lastBox.current = box;
    if (!placeKey || !from || typeof dock.animate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    glide.current = dock.animate(
      [
        { transform: `translate(${from.left - box.left}px, ${from.top - box.top}px)` },
        { transform: "translate(0, 0)" },
      ],
      { duration: GLIDE_MS, easing: "ease-out", composite: "add" },
    );
  }, [dockRef, placeKey]);
};

/** Room the Quests tab keeps under its top where the lesson stood near the screen's foot. */
const QUESTS_MIN_HEIGHT_PX = 380;

/** How long the dock takes to glide to its subject. */
const GLIDE_MS = 250;

/** Below Tailwind's md breakpoint the dock would cover most of the page when open. */
const PHONE_QUERY = "(max-width: 767px)";

function ActivityQuests({
  user,
  lesson,
  isControlMarked,
  scrollerRef,
}: {
  user: ActivityUser;
  lesson: QuestsTabLesson | null;
  /** The lesson's claim takes the spotlight, scrolled into view once shown. */
  isControlMarked: boolean;
  scrollerRef: RefObject<HTMLDivElement | null>;
}) {
  const spotlight = useQuestControlBox(scrollerRef, isControlMarked);
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
  return (
    <div className="space-y-2 p-3">
      {spotlight && <Spotlight box={spotlight.control} marks={spotlight.lit} />}
      {lesson ? (
        <p
          data-quests-prompt=""
          className="flex items-start gap-2 rounded-lg border border-amber-500/70 bg-amber-500/15 px-3 py-2 text-sm font-semibold"
        >
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
        className="text-primary inline-block py-2 text-sm underline dark:text-amber-300"
      >
        Profile &amp; logbook
      </Link>
    </div>
  );
}

/**
 * Where the lesson's claim stands in the Quests tab, and the callout that stays
 * lit with it. The claim is brought into view once, when it appears; the player's own
 * scrolling is left alone after that, and a control scrolled out of the tab has no box.
 */
const useQuestControlBox = (
  scrollerRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
) => {
  const [spotlight, setSpotlight] = useState<{
    control: SpotlightBox;
    lit: SpotlightMark[];
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let shown: Element | null = null;
    const stop = trackLayout(() => {
      const scroller = scrollerRef.current;
      const control = scroller?.querySelector(QUEST_CONTROL_SELECTOR) ?? null;
      if (
        !scroller ||
        !control ||
        !isUsableHighlightRect(control.getBoundingClientRect())
      ) {
        setSpotlight(null);
        return null;
      }
      const view = scroller.getBoundingClientRect();
      if (control !== shown) {
        shown = control;
        const overflow =
          control.getBoundingClientRect().bottom + CONTROL_MARGIN_PX - view.bottom;
        if (overflow > 0) scroller.scrollTop += overflow;
      }
      const prompt = scroller.querySelector("[data-quests-prompt]");
      const box = getVisibleBox(control, view);
      const promptBox = prompt && getVisibleBox(prompt, view);
      setSpotlight((prev) => {
        const lit = promptBox ? [{ key: "prompt", label: "", box: promptBox }] : [];
        if (!box) return null;
        const isUnmoved =
          prev &&
          isSameBox(prev.control, box) &&
          prev.lit.length === lit.length &&
          prev.lit.every((mark, i) => {
            const other = lit[i];
            return !!other && isSameBox(mark.box, other.box);
          });
        return isUnmoved ? prev : { control: box, lit };
      });
      return control;
    });
    const scroller = scrollerRef.current;
    const onScroll = () => window.dispatchEvent(new Event(TUTORIAL_LAYOUT_EVENT));
    scroller?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller?.removeEventListener("scroll", onScroll);
      stop();
      setSpotlight(null);
    };
  }, [enabled, scrollerRef]);
  return spotlight;
};

/** The part of an element inside `view`, or null when hardly any of it is. */
const getVisibleBox = (element: Element, view: DOMRect): SpotlightBox | null => {
  const rect = element.getBoundingClientRect();
  const top = Math.max(rect.top, view.top);
  const height = Math.min(rect.bottom, view.bottom) - top;
  return height < Math.min(16, rect.height)
    ? null
    : { top, left: rect.left, width: rect.width, height };
};

/** The answers or claim of the lesson's quest. */
const QUEST_CONTROL_SELECTOR =
  "[data-lesson-quest] :is(#tutorial-objective-claim, [data-quest-claim])";
/** Room under the control for the spotlight's ring. */
const CONTROL_MARGIN_PX = 12;

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
  /** The quest a lesson sends the player to: open. */
  featured?: boolean;
  onPin: () => void;
}) {
  const [expanded, setExpanded] = useState(pinned || featured);
  const id = useId();
  return (
    <article
      data-lesson-quest={featured ? "" : undefined}
      className={cn("rounded-lg border", pinned && "border-primary/50")}
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
  status: user.status,
  userQuests: user.userQuests,
  questData: user.questData,
});

type ActivityUser = ReturnType<typeof selectActivityUser>;

/** The dock's open state and tab during one guided lesson. */
type GuidedView = { lessonId: string; open: boolean; tab: "tutorial" | "quests" };

/** The call-to-action pulse, for three beats: news the player may leave for later. */
const ATTENTION_PULSE =
  "motion-safe:animate-cta-pulse motion-safe:[animation-iteration-count:3]";
