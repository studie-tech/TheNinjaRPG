"use client";

import { AlertCircle } from "lucide-react";
import dynamic from "next/dynamic";
import type React from "react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/localstorage";
import { GameSettingsPanel } from "@/layout/GameSettings";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";
import { type TicketType, TicketTypes } from "@/validators/misc";

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
  const [showActive, setShowActive] = useLocalStorage<TicketType>(
    "ticketType2",
    "ai_support",
  );
  const [isOpen, setIsOpen] = useState(false);

  // Mutation to toggle tutorial
  const { mutate: toggleTutorial, isPending: isTogglingTutorial } =
    api.profile.updatePreferences.useMutation({
      onSuccess: async (result, input) => {
        if (!result.success) {
          showMutationToast(result);
          return;
        }
        await updateUser(input);
        setIsOpen(false);
      },
    });

  // Check if user has incomplete starter or tier quests with tutorial disabled
  const hasIncompleteStarterOrTierQuests =
    userData?.userQuests.some(
      (uq) => ["starter", "tier"].includes(uq.quest.questType) && uq.completed === 0,
    ) ?? false;

  // Show notification when tutorial is off but there are incomplete quests
  const showTutorialNotification =
    userData?.tutorialOn === false && hasIncompleteStarterOrTierQuests;

  const safeTicketType = getValidTicketType(showActive);
  const setShowActiveSafe = (value: string) => setShowActive(getValidTicketType(value));

  useEffect(() => {
    if (showActive !== safeTicketType) setShowActive(safeTicketType);
  }, [showActive, safeTicketType, setShowActive]);

  // Ensure defaultValue is always a valid string
  const safeDefaultValue = safeTicketType;

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
            defaultValue={safeDefaultValue}
            className="flex min-h-0 flex-col gap-3"
            onValueChange={setShowActiveSafe}
          >
            <TabsList className="grid w-full shrink-0 grid-cols-4 text-center">
              <TabsTrigger value="ai_support">Ask AI</TabsTrigger>
              <TabsTrigger value="human_support">Human</TabsTrigger>
              <TabsTrigger value="audio_settings">Settings</TabsTrigger>
              <TabsTrigger value="tutorial_settings" className="relative">
                Tutorial
                {showTutorialNotification && (
                  <span className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 text-white text-xs">
                    !
                  </span>
                )}
              </TabsTrigger>
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

            <TabsContent
              value="audio_settings"
              className="mt-0 min-h-0 w-full overflow-y-auto"
            >
              <p className="mb-2 font-bold text-lg">Game Settings</p>
              <div className="max-h-[400px] overflow-y-auto">
                <GameSettingsPanel
                  userData={userData}
                  updateUser={updateUser}
                  onNavigate={() => setIsOpen(false)}
                />
              </div>
            </TabsContent>

            <TabsContent
              value="tutorial_settings"
              className="mt-0 min-h-0 w-full overflow-y-auto"
            >
              <p className="mb-2 font-bold text-lg">Tutorial Settings</p>
              <div className="space-y-4">
                <p className="text-sm">
                  The tutorial helps new players learn the game mechanics. You can
                  enable or disable it at any time.
                </p>
                {showTutorialNotification && (
                  <div className="flex items-start gap-3 rounded-lg border border-orange-500 bg-orange-500/10 p-4">
                    <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-orange-500" />
                    <div className="space-y-1">
                      <p className="font-semibold text-orange-500">
                        You have active quests!
                      </p>
                      <p className="text-muted-foreground text-sm">
                        Enable the tutorial to get guidance on your current starter or
                        tier quests. The tutorial assistant will help you complete them.
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="font-semibold">Tutorial Mode</p>
                    <p className="text-muted-foreground text-sm">
                      {userData?.tutorialOn
                        ? "Currently enabled"
                        : "Currently disabled"}
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      toggleTutorial({ tutorialOn: !userData?.tutorialOn });
                    }}
                    disabled={isTogglingTutorial}
                    variant={userData?.tutorialOn ? "destructive" : "default"}
                  >
                    {isTogglingTutorial
                      ? "Updating..."
                      : userData?.tutorialOn
                        ? "Disable Tutorial"
                        : "Enable Tutorial"}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default LowerRightHelpBtn;

/** Normalize persisted preferences and values received from the tab control. */
const getValidTicketType = (value: unknown): TicketType =>
  typeof value === "string" && TicketTypes.includes(value as TicketType)
    ? (value as TicketType)
    : "ai_support";
