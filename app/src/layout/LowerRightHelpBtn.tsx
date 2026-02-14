"use client";

import { AlertCircle } from "lucide-react";
import Link from "next/link";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLocalStorage } from "@/hooks/localstorage";
import ChatBox from "@/layout/ChatBox";
import { GameSettingsPanel } from "@/layout/GameSettings";
import { cn } from "@/libs/shadui";
import { useUserData } from "@/utils/UserContext";
import { type TicketType, TicketTypes } from "@/validators/misc";

interface LowerRightHelpProps {
  className?: string;
  children?: React.ReactNode;
}

const LowerRightHelpBtn: React.FC<LowerRightHelpProps> = (props) => {
  const { data: userData, updateUser } = useUserData();
  const [showActive, setShowActive] = useLocalStorage<TicketType>(
    "ticketType2",
    "ai_support",
  );
  const [isOpen, setIsOpen] = useState(false);
  const utils = api.useUtils();

  // Mutation to toggle tutorial
  const { mutate: toggleTutorial, isPending: isTogglingTutorial } =
    api.profile.updatePreferences.useMutation({
      onSuccess: async () => {
        await utils.profile.getUser.invalidate();
        setIsOpen(false);
      },
    });

  // Check if user has incomplete starter or tier quests with tutorial disabled
  const hasIncompleteStarterOrTierQuests = useMemo(() => {
    if (!userData?.userQuests) return false;
    return userData.userQuests.some(
      (uq) => ["starter", "tier"].includes(uq.quest.questType) && uq.completed === 0,
    );
  }, [userData?.userQuests]);

  // Show notification when tutorial is off but there are incomplete quests
  const showTutorialNotification =
    userData?.tutorialOn === false && hasIncompleteStarterOrTierQuests;

  // Helper function to safely validate ticket types
  const getValidTicketType = useCallback((value: any): TicketType => {
    try {
      if (typeof value === "string" && TicketTypes.includes(value as TicketType)) {
        return value as TicketType;
      }
    } catch (error) {
      console.error("Error validating ticket type:", error);
    }
    return "ai_support";
  }, []);

  // Ensure showActive is always a valid TicketType
  const safeTicketType = useMemo(() => {
    return getValidTicketType(showActive);
  }, [showActive, getValidTicketType]);

  // Handle tool calls from AI
  const handleToolCall = useCallback((toolCall: any) => {
    try {
      // Implement specific tool call handling if needed
      // Ensure we don't accidentally render the toolCall object
      if (toolCall && typeof toolCall === "object") {
        // Process the tool call but don't render it directly
        return undefined;
      }
    } catch (error) {
      console.error("Error in handleToolCall:", error);
    }
  }, []);

  // Safe setter for showActive that validates the value
  const setShowActiveSafe = useCallback(
    (value: any) => {
      try {
        // Ensure the value is a string and is in the valid ticket types
        if (typeof value === "string" && TicketTypes.includes(value as TicketType)) {
          setShowActive(value as TicketType);
        } else {
          console.warn("Invalid ticket type received:", value, typeof value);
          setShowActive("ai_support");
        }
      } catch (error) {
        console.error("Error in setShowActiveSafe:", error);
        setShowActive("ai_support");
      }
    },
    [setShowActive],
  );

  // If chosen ticket type if not of available type, set to ai_support
  useEffect(() => {
    try {
      if (!TicketTypes.includes(showActive)) {
        setShowActive("ai_support");
      }
    } catch (error) {
      console.error("Error in useEffect:", error);
      setShowActive("ai_support");
    }
  }, [showActive, setShowActive]);

  // Ensure defaultValue is always a valid string
  const safeDefaultValue = safeTicketType;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger name="supportBtn" aria-label="supportBtn">
        <div className={cn("relative", props.className)}>
          {props.children}
          {showTutorialNotification && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-[1.25rem] animate-pulse items-center justify-center rounded-full bg-red-500 text-white text-xs">
              !
            </span>
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent className="m-2 min-w-96 max-w-96">
        {!userData ? (
          <div>
            <p className="mb-2 font-bold text-lg">Audio Settings</p>
            <div className="max-h-[400px] overflow-y-auto">
              <GameSettingsPanel userData={userData} updateUser={updateUser} />
            </div>
          </div>
        ) : (
          <Tabs
            defaultValue={safeDefaultValue}
            className="flex flex-col items-center justify-center"
            onValueChange={setShowActiveSafe}
          >
            <TabsContent value="human_support" className="flex flex-col gap-2">
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
                3. Maybe you can find the answer you are looking for on our{" "}
                <Link
                  href="https://the-ninja-rpg.fandom.com/wiki/Getting_Started"
                  className="font-bold text-orange-500 hover:text-orange-700"
                >
                  community manual
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
            <TabsContent value="ai_support" className="w-full">
              <p className="mb-2 font-bold text-lg">Get AI Help</p>
              <div className="h-[400px]">
                <ChatBox
                  aiProps={{
                    apiEndpoint: "/api/chat/support",
                    systemMessage:
                      "You are Seichi AI, a helpful assistant for TheNinja-RPG players.",
                  }}
                  onToolCall={handleToolCall}
                  position="relative"
                  showCloseButton={false}
                  showHeader={false}
                  showFeedback={true}
                  autoFocus={false}
                  className="h-full"
                />
              </div>
            </TabsContent>

            <TabsContent value="audio_settings" className="w-full">
              <p className="mb-2 font-bold text-lg">Game Settings</p>
              <div className="max-h-[400px] overflow-y-auto">
                <GameSettingsPanel userData={userData} updateUser={updateUser} />
              </div>
            </TabsContent>

            <TabsContent value="tutorial_settings" className="w-full">
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

            <TabsList className="mt-2 grid grid-cols-4 text-center">
              <TabsTrigger value="ai_support">AI</TabsTrigger>
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
          </Tabs>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default LowerRightHelpBtn;
