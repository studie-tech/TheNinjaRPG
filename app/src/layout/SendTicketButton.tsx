"use client";

import React, { useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/app/_trpc/client";
import { useLocalStorage } from "@/hooks/localstorage";
import { showMutationToast } from "@/libs/toast";
import { type TicketType, TicketTypes } from "@/validators/misc";
import ChatBox from "@/layout/ChatBox";
import { Button } from "@/components/ui/button";
import { useUserData } from "@/utils/UserContext";

interface SendTicketBtnProps {
  children?: React.ReactNode;
}

const SendTicketBtn: React.FC<SendTicketBtnProps> = (props) => {
  const { updateUser } = useUserData();
  const [showActive, setShowActive] = useLocalStorage<TicketType>(
    "ticketType2",
    "ai_support",
  );

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

  // Tutorial reset mutation
  const { mutate: resetTutorial } = api.profile.updateTutorialStep.useMutation({
    onSuccess: async (data) => {
      if (data.success && data.data) {
        await updateUser({ tutorialStep: data.data.tutorialStep });
        showMutationToast({ success: true, message: "Tutorial has been reset!" });
      }
    },
  });

  // Handle tool calls from AI
  const handleToolCall = useCallback((toolCall: any) => {
    try {
      console.log("Tool call received:", toolCall);
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

  // Handle tutorial reset
  const handleTutorialReset = useCallback(() => {
    try {
      resetTutorial({ step: 0 });
    } catch (error) {
      console.error("Error in handleTutorialReset:", error);
    }
  }, [resetTutorial]);

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
    <Popover>
      <PopoverTrigger name="supportBtn" aria-label="supportBtn">
        {props.children}
      </PopoverTrigger>
      <PopoverContent className="m-2 min-w-96 max-w-96">
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
                className="font-bold hover:text-orange-700 text-orange-500"
              >
                tavern
              </Link>
              .
            </p>
            <p className="italic">
              2. Questions related to moderation decisions, please comment on the{" "}
              <Link
                href="/reports"
                className="font-bold hover:text-orange-700 text-orange-500"
              >
                report
              </Link>{" "}
              in question.
            </p>
            <p className="italic">
              3. Maybe you can find the answer you are looking for on our{" "}
              <Link
                href="https://the-ninja-rpg.fandom.com/wiki/Getting_Started"
                className="font-bold hover:text-orange-700 text-orange-500"
              >
                community manual
              </Link>
              .
            </p>
            <p>
              4. Alternatively, you may create a ticket in the{" "}
              <Link
                href={"/support"}
                className="font-bold hover:text-orange-700 text-orange-500"
              >
                support
              </Link>{" "}
              page.
            </p>
          </TabsContent>
          <TabsContent value="ai_support" className="w-full">
            <p className="font-bold text-lg mb-2">Get AI Help</p>
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
                className="h-full"
              />
            </div>
          </TabsContent>

          <TabsContent value="tutorial" className="flex flex-col gap-4">
            <p className="font-bold text-lg">Reset Tutorial</p>
            <p className="text-sm">
              Click the button below to restart the game tutorial from the beginning.
            </p>
            <Button onClick={handleTutorialReset} className="w-full">
              Reset Tutorial
            </Button>
          </TabsContent>

          <TabsList className="text-center mt-2">
            <TabsTrigger value="ai_support">AI Support</TabsTrigger>
            <TabsTrigger value="human_support">Human Support & Bugs</TabsTrigger>
            <TabsTrigger value="tutorial">Tutorial</TabsTrigger>
          </TabsList>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
};

export default SendTicketBtn;
