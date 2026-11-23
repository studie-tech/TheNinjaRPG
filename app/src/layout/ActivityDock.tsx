"use client";

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  ArrowLeftRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ListChecks,
  Pin,
  PinOff,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/localstorage";
import { useActivityDock } from "@/hooks/useActivityDock";
import { SETTINGS_HREF } from "@/layout/GameSettings";
import Link from "@/layout/Link";
import { LogbookEntry } from "@/layout/Logbook";
import { activityDockRequestAtom, activityDockStateAtom } from "@/libs/activityDock";
import { chatPanelAtom } from "@/libs/chatPanel";
import { cn } from "@/libs/shadui";
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
  const { swapSides, setSwapSides } = useActivityDock();
  const [storedOpen, setOpen] = useLocalStorage(
    `activityDockOpen:${user?.userId}`,
    isTutorialActive(user),
  );
  const [storedTab, setTab] = useLocalStorage(
    `activityDockTab:${user?.userId}`,
    isTutorialActive(user) ? "tutorial" : "quests",
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
  const panelId = useId();
  const request = useAtomValue(activityDockRequestAtom);
  const reportState = useSetAtom(activityDockStateAtom);
  const previousRequest = useRef(request.sequence);
  const focusRequested = useRef(false);
  useEffect(() => {
    reportState({ userId: user?.userId ?? null, panelId, open });
  }, [user?.userId, panelId, open, reportState]);
  useEffect(
    () => () => {
      reportState({ userId: null, panelId: null, open: false });
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
    }
    changeOpen(request.open);
  }, [request, user, changeOpen, setChat]);
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
  if (!user && !guided) return null;

  return (
    <aside
      data-activity-dock
      data-battle-focus-layer={lessonShown ? "" : undefined}
      aria-label="Activity"
      className={cn(
        // The lesson's scroll height leaves room for the portrait above the dock. A dock
        // dodging a highlight rises to just below the top bar, and its portrait steps aside.
        "pointer-events-none fixed bottom-24 z-40 max-w-[calc(100vw-2rem)] [--assistant-portrait-height:min(16rem,24dvh)] md:bottom-5 md:[--assistant-portrait-height:min(24rem,32dvh)] has-[[data-dodge-highlight=true]]:top-20 has-[[data-dodge-highlight=true]]:bottom-auto",
        lessonShown && "z-[61]",
        swapSides ? "right-4 md:right-5" : "left-4 md:left-5",
      )}
    >
      {open ? (
        <Tabs
          value={tab}
          onValueChange={changeTab}
          id={panelId}
          className="pointer-events-auto relative w-[420px] max-w-[calc(100vw-2rem)] rounded-xl border-2 border-primary/60 bg-card text-card-foreground shadow-xl"
        >
          <header className="relative z-10 flex items-center gap-1 rounded-t-[calc(var(--radius)-2px)] border-b bg-card px-2 py-1.5">
            <TabsList
              aria-label="Activity"
              className="h-auto w-auto flex-1 justify-start bg-transparent p-0"
            >
              {(user ? DOCK_TABS : GUEST_TABS).map((value) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="flex h-9 items-center gap-1.5 px-2 data-[state=active]:font-semibold"
                >
                  {value === "tutorial" ? (
                    <BookOpen className="h-4 w-4" />
                  ) : (
                    <ListChecks className="h-4 w-4" />
                  )}
                  {capitalizeFirstLetter(value)}
                </TabsTrigger>
              ))}
            </TabsList>
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
              <ActivityQuests key={user.userId} user={user} />
            </TabsContent>
          ) : null}
          <TabsContent value="tutorial" className="mt-0">
            {user?.tutorialOn === false && !guided ? (
              <p className="p-4 text-sm text-muted-foreground">
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
            // Guests and compact frames without a visible mobile bar keep a launcher.
            user && "[[data-mobile-activity-nav=true]_&]:hidden",
          )}
          aria-expanded={false}
          aria-controls={panelId}
          aria-label="Open Activity"
          onClick={() => {
            setChat((current) => ({ ...current, owner: null, openRequested: false }));
            changeOpen(true);
          }}
        >
          <ListChecks className="h-4 w-4" />
          Activity
        </Button>
      )}
      {!(open && tab === "tutorial" && !guided) && hiddenLesson}
    </aside>
  );
}

function ActivityQuests({ user }: { user: ActivityUser }) {
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
  const ordered = [...quests].sort(
    (a, b) => Number(pins.includes(b.id)) - Number(pins.includes(a.id)),
  );
  return (
    <div className="space-y-2 p-3">
      <p className="text-muted-foreground text-xs">
        Pin the objectives you want to keep at the top.
      </p>
      {ordered.map((entry) => {
        const tracker = user.questData?.find((item) => item.id === entry.questId);
        const pinned = pins.includes(entry.id);
        return (
          tracker && (
            <ActivityQuest
              key={entry.id}
              entry={entry}
              tracker={tracker}
              pinned={pinned}
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
        <p className="py-4 text-sm text-muted-foreground">
          No active quests or missions.
        </p>
      )}
      <Link
        href="/profile"
        className="inline-block py-2 text-primary text-xs underline dark:text-amber-300"
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
  onPin,
}: {
  entry: NonNullable<UserWithRelations>["userQuests"][number];
  tracker: QuestTrackerType;
  pinned: boolean;
  onPin: () => void;
}) {
  const [expanded, setExpanded] = useState(pinned);
  const id = useId();
  return (
    <article className={cn("rounded-lg border", pinned && "border-primary/50")}>
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
            <span className="block text-muted-foreground text-xs">
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
  userQuests: user.userQuests,
  questData: user.questData,
});

type ActivityUser = ReturnType<typeof selectActivityUser>;

/** The dock's open state and tab during one guided lesson. */
type GuidedView = { lessonId: string; open: boolean; tab: "tutorial" | "quests" };
