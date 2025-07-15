"use client";

import React, { useState, useEffect } from "react";
import { HelpCircle } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ZodCombinedQuest } from "@/hooks/quest";
import type { DeepPartial } from "@/utils/typeutils";

export interface QuestHelperProps {
  quest: DeepPartial<ZodCombinedQuest>;
}

export const QuestHelper: React.FC<QuestHelperProps> = (props) => {
  const [isOpen, setIsOpen] = useState(false);
  const { quest } = props;

  // Set initial state based on screen size
  useEffect(() => {
    const checkScreenSize = () => {
      const isDesktop = window.innerWidth >= 768; // md breakpoint
      setIsOpen(isDesktop);
    };

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  return (
    <div className="inline-block">
      <Sheet open={isOpen} onOpenChange={setIsOpen} modal={false}>
        <SheetTrigger asChild>
          <Button
            className="flex items-center gap-2"
            variant={isOpen ? "default" : "outline"}
          >
            <HelpCircle className="h-6 w-6" />
          </Button>
        </SheetTrigger>

        <SheetContent
          side="right"
          className="w-80 sm:w-96"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              Quest Helper
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="p-3 bg-gray-50 rounded-lg border">
              <h3 className="font-medium text-gray-900 mb-2">Quest: {quest.name}</h3>
              <p className="text-sm text-gray-600 capitalize">
                Type: <span className="font-medium">{quest.questType}</span>
              </p>
            </div>

            {renderHuntingTips(quest)}

            {quest.questType !== "hunting" && (
              <div className="p-3 bg-gray-50 rounded-lg border text-center">
                <p className="text-sm text-gray-600">
                  No specific tips available for this quest type yet.
                </p>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

/**
 * Renders the tips for hunting quests
 * @param quest - The quest to render the tips for
 * @returns The tips for hunting quests
 */
const renderHuntingTips = (quest: DeepPartial<ZodCombinedQuest>) => {
  if (quest.questType !== "hunting") return null;

  return (
    <div className="space-y-4">
      <Alert>
        <HelpCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Hunting Quest Tips:</strong>
        </AlertDescription>
      </Alert>

      <div className="space-y-3 text-sm">
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
          <h4 className="font-medium text-blue-900 mb-2">Availability</h4>
          <p className="text-blue-800">
            This quest will only be available to hunters with the appropriate hunting
            rank.
          </p>
        </div>

        <div className="p-3 bg-green-50 rounded-lg border border-green-200">
          <h4 className="font-medium text-green-900 mb-2">Reward Configuration</h4>
          <p className="text-green-800">
            Toggle the{" "}
            <code className="bg-green-100 px-1 rounded">reward_hunter_items</code>{" "}
            either on the quest or objective to reward random drops based on hunting
            rank.
          </p>
        </div>

        <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
          <h4 className="font-medium text-purple-900 mb-2">Location Encounters</h4>
          <p className="text-purple-800">
            Use the{" "}
            <code className="bg-purple-100 px-1 rounded">
              win_encounter_at_location
            </code>{" "}
            objective to send off the user to win random encounters at specific
            locations.
          </p>
        </div>

        <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
          <h4 className="font-medium text-orange-900 mb-2">Combat Configuration</h4>
          <p className="text-orange-800">
            Add multiple attackers with random encounter chances. Set the{" "}
            <code className="bg-orange-100 px-1 rounded">attackers_max_per_battle</code>{" "}
            to limit how many can attack at a time.
          </p>
        </div>
      </div>
    </div>
  );
};
