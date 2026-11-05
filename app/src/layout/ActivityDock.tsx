"use client";

import { useAtom } from "jotai";
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
import { chatPanelAtom } from "@/libs/chatPanel";
import { cn } from "@/libs/shadui";
import { isTutorialActive } from "@/libs/tutorial";
import type { UserWithRelations } from "@/routers/profile";
import { capitalizeFirstLetter } from "@/utils/string";
import { useUserData } from "@/utils/UserContext";
import type { QuestTrackerType } from "@/validators/objectives";

/** A collapsible home for lessons and active quests, opposite the chat launcher. */
export function ActivityDock({
  children,
  hiddenLesson,
}: {
  children: ReactNode;
  /** Rendered in place of `children` while the lesson is out of view. */
  hiddenLesson?: ReactNode;
}) {
  const { data: user } = useUserData();
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
  const tab = storedTab === "tutorial" ? "tutorial" : "quests";
  const open = storedOpen === true && chat.owner === null;
  const panelId = useId();
  const previousTutorialOn = useRef(user?.tutorialOn);
  useEffect(() => {
    // Re-enabling lessons in Settings must also reveal them in a collapsed dock.
    if (previousTutorialOn.current === false && user?.tutorialOn === true) {
      setTab("tutorial");
      setOpen(true);
    }
    previousTutorialOn.current = user?.tutorialOn;
  }, [user?.tutorialOn, setOpen, setTab]);
  if (!user) return null;

  return (
    <aside
      data-activity-dock
      data-battle-focus-layer={
        open && tab === "tutorial" && user.tutorialOn !== false ? "" : undefined
      }
      aria-label="Activity"
      className={cn(
        // The lesson's scroll height leaves room for the portrait above the dock. A dock
        // dodging a highlight rises to just below the top bar, and its portrait steps aside.
        "pointer-events-none fixed bottom-24 z-40 max-w-[calc(100vw-2rem)] [--assistant-portrait-height:min(16rem,24dvh)] md:bottom-5 md:[--assistant-portrait-height:min(24rem,32dvh)] has-[[data-dodge-highlight=true]]:top-20 has-[[data-dodge-highlight=true]]:bottom-auto",
        open && tab === "tutorial" && user.tutorialOn !== false && "z-[61]",
        swapSides ? "right-4 md:right-5" : "left-4 md:left-5",
      )}
    >
      {open ? (
        <Tabs
          value={tab}
          onValueChange={setTab}
          id={panelId}
          className="pointer-events-auto relative w-[420px] max-w-[calc(100vw-2rem)] rounded-xl border-2 border-primary/60 bg-card text-card-foreground shadow-xl"
        >
          <header className="relative z-10 flex items-center gap-1 rounded-t-[calc(var(--radius)-2px)] border-b bg-card px-2 py-1.5">
            <TabsList
              aria-label="Activity"
              className="h-auto w-auto flex-1 justify-start bg-transparent p-0"
            >
              {(["tutorial", "quests"] as const).map((value) => (
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
              onClick={() => setOpen(false)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </header>
          <TabsContent
            value="quests"
            className="mt-0 max-h-[min(55dvh,520px)] overflow-y-auto overscroll-contain rounded-b-xl"
          >
            <ActivityQuests key={user.userId} user={user} />
          </TabsContent>
          <TabsContent value="tutorial" className="mt-0">
            {user.tutorialOn === false ? (
              <p className="p-4 text-sm text-muted-foreground">
                Tutorial is off.{" "}
                <Link
                  className="text-primary underline"
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
          className="pointer-events-auto h-11 gap-2 rounded-full bg-card shadow-lg"
          aria-expanded={false}
          aria-controls={panelId}
          aria-label="Open Activity"
          onClick={() => {
            setChat((current) => ({ ...current, owner: null, openRequested: false }));
            setOpen(true);
          }}
        >
          <ListChecks className="h-4 w-4" />
          Activity
        </Button>
      )}
      {!(open && tab === "tutorial") && hiddenLesson}
    </aside>
  );
}

function ActivityQuests({ user }: { user: NonNullable<UserWithRelations> }) {
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
        className="inline-block py-2 text-primary text-xs underline"
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
