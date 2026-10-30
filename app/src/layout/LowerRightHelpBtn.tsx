"use client";

import { AlertCircle } from "lucide-react";
import dynamic from "next/dynamic";
import type React from "react";
import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/localstorage";
import { GameSettingsPanel, SETTINGS_HREF } from "@/layout/GameSettings";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { hasTutorialReminder } from "@/layout/TutorialSettings";
import { cn } from "@/libs/shadui";
import { useUserData } from "@/utils/UserContext";

/**
 * ChatBox brings the AI SDK (`ai`, `@ai-sdk/react` and its swr dependency), and this button sits
 * in every layout, so a static import would put that stack in every page's initial JS. The chat
 * renders only once the popover is open on its tab, so it loads then.
 */
const ChatBox = dynamic(() => import("@/layout/ChatBox"), {
  ssr: false,
  loading: () => <Loader explanation="Loading chat" />,
});

interface LowerRightHelpProps {
  className?: string;
  children?: React.ReactNode;
  ariaLabel?: string;
}

const LowerRightHelpBtn: React.FC<LowerRightHelpProps> = (props) => {
  const { data: userData, updateUser } = useUserData();
  const [showActive, setShowActive] = useLocalStorage<HelpTab>(
    "ticketType2",
    "ai_support",
  );
  const [isOpen, setIsOpen] = useState(false);

  // Tutorial is off while starter or tier quests are still open
  const showTutorialNotification = hasTutorialReminder(userData);

  const safeTab = getValidHelpTab(showActive);
  const setShowActiveSafe = (value: string) => setShowActive(getValidHelpTab(value));

  useEffect(() => {
    if (showActive !== safeTab) setShowActive(safeTab);
  }, [showActive, safeTab, setShowActive]);

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        name="supportBtn"
        aria-label={props.ariaLabel ?? (!userData ? "Audio settings" : "Support")}
      >
        <div className={cn("relative", props.className)}>
          {props.children}
          {showTutorialNotification && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] animate-pulse items-center justify-center rounded-full bg-red-500 text-white text-xs">
              !
            </span>
          )}
        </div>
      </PopoverTrigger>
      {/* Let panes shrink within the trigger's available space to keep the AI composer visible. */}
      <PopoverContent
        collisionPadding={8}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[calc(100vw-1rem)] max-w-[32rem] min-w-0 flex-col p-3 sm:w-[32rem]"
      >
        {!userData ? (
          <div className="min-h-0 overflow-y-auto">
            <p className="mb-2 font-bold text-lg">Audio Settings</p>
            <div className="max-h-[400px] overflow-y-auto">
              <GameSettingsPanel
                userData={userData}
                updateUser={updateUser}
                onNavigate={() => setIsOpen(false)}
              />
            </div>
          </div>
        ) : (
          <Tabs
            defaultValue={safeTab}
            className="flex min-h-0 flex-col gap-3"
            onValueChange={setShowActiveSafe}
          >
            {showTutorialNotification && (
              <Link
                href={TUTORIAL_SETTINGS_HREF}
                onClick={() => setIsOpen(false)}
                className="flex shrink-0 items-start gap-2 rounded-lg border border-orange-500 bg-orange-500/10 p-3 text-sm"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-orange-500" />
                <span>
                  You have active quests and the tutorial is off.{" "}
                  <span className="font-semibold text-orange-500 underline">
                    Turn it on in Settings
                  </span>
                </span>
              </Link>
            )}
            <TabsList className="grid w-full shrink-0 grid-cols-2 text-center">
              <TabsTrigger value="ai_support">Ask AI</TabsTrigger>
              <TabsTrigger value="human_support">Human</TabsTrigger>
            </TabsList>

            <TabsContent
              value="human_support"
              className="mt-0 flex min-h-0 flex-col gap-2 overflow-y-auto"
            >
              <p className="font-bold text-lg">Get Human Help</p>
              <p className="italic">
                1. Questions related to game mechanics, please ask your fellow ninja in
                the{" "}
                <Link
                  href="/tavern"
                  className="font-bold text-orange-500 hover:text-orange-700"
                >
                  tavern
                </Link>
                .
              </p>
              <p className="italic">
                2. Questions related to moderation decisions, please comment on the{" "}
                <Link
                  href="/reports"
                  className="font-bold text-orange-500 hover:text-orange-700"
                >
                  report
                </Link>{" "}
                in question.
              </p>
              <p className="italic">
                3. Maybe you can find the answer you are looking for in the{" "}
                <Link
                  href="/guide"
                  className="font-bold text-orange-500 hover:text-orange-700"
                >
                  player guide
                </Link>
                .
              </p>
              <p>
                4. Alternatively, you may create a ticket in the{" "}
                <Link
                  href={"/support"}
                  className="font-bold text-orange-500 hover:text-orange-700"
                >
                  support
                </Link>{" "}
                page.
              </p>
            </TabsContent>
            <TabsContent
              value="ai_support"
              className="mt-0 flex min-h-0 w-full flex-col"
            >
              <div className="h-[36rem] min-h-0 overflow-hidden rounded-md border">
                <ChatBox
                  position="relative"
                  showCloseButton={false}
                  showHeader={false}
                  showFeedback={true}
                  autoFocus={false}
                  className="h-full"
                />
              </div>
            </TabsContent>
          </Tabs>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default LowerRightHelpBtn;

const HELP_TABS = ["ai_support", "human_support"] as const;
type HelpTab = (typeof HELP_TABS)[number];

const TUTORIAL_SETTINGS_HREF = `${SETTINGS_HREF}&settings=help&setting=tutorial`;

/** Normalize persisted tabs, including the Settings and Tutorial tabs that moved to the settings page. */
const getValidHelpTab = (value: unknown): HelpTab =>
  HELP_TABS.find((tab) => tab === value) ?? "ai_support";
