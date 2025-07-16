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
import type { ZodItemType } from "@/libs/combat/types";
import type { DeepPartial } from "@/utils/typeutils";

export interface QuestHelperProps {
  quest: DeepPartial<ZodCombinedQuest>;
}

export interface ItemHelperProps {
  item: DeepPartial<ZodItemType>;
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

            {renderGatheringTips(quest)}

            {quest.questType !== "hunting" && quest.questType !== "gathering" && (
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

export const ItemHelper: React.FC<ItemHelperProps> = (props) => {
  const [isOpen, setIsOpen] = useState(false);
  const { item } = props;

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
              Item Helper
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="p-3 bg-gray-50 rounded-lg border">
              <h3 className="font-medium text-gray-900 mb-2">Item: {item.name}</h3>
              <p className="text-sm text-gray-600 capitalize">
                Type: <span className="font-medium">{item.itemType}</span>
              </p>
            </div>

            {renderItemTips(item)}
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

/**
 * Renders the tips for gathering quests
 * @param quest - The quest to render the tips for
 * @returns The tips for gathering quests
 */
const renderGatheringTips = (quest: DeepPartial<ZodCombinedQuest>) => {
  if (quest.questType !== "gathering") return null;

  return (
    <div className="space-y-4">
      <Alert>
        <HelpCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Gathering Quest Tips:</strong>
        </AlertDescription>
      </Alert>

      <div className="space-y-3 text-sm">
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
          <h4 className="font-medium text-blue-900 mb-2">Objective Type</h4>
          <p className="text-blue-800">
            Use the <code className="bg-blue-100 px-1 rounded">collect_item</code>{" "}
            objective to set up gathering requirements.
          </p>
        </div>

        <div className="p-3 bg-green-50 rounded-lg border border-green-200">
          <h4 className="font-medium text-green-900 mb-2">Reward Configuration</h4>
          <p className="text-green-800">
            Toggle the{" "}
            <code className="bg-green-100 px-1 rounded">reward_gathering_items</code>{" "}
            either on the quest or objective to reward random drops based on gathering
            rank.
          </p>
        </div>

        <div className="p-3 bg-purple-50 rounded-lg border border-purple-200">
          <h4 className="font-medium text-purple-900 mb-2">Random Drops</h4>
          <p className="text-purple-800">
            Do not set{" "}
            <code className="bg-purple-100 px-1 rounded">collectItemIds</code> if you
            only want random drops from gathering activities.
          </p>
        </div>

        <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
          <h4 className="font-medium text-orange-900 mb-2">Collection Time</h4>
          <p className="text-orange-800">
            Set the{" "}
            <code className="bg-orange-100 px-1 rounded">collect_time_minutes</code> to
            configure how long each collection action takes.
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * Renders the tips for item configuration
 * @param item - The item to render the tips for
 * @returns The tips for item configuration
 */
const renderItemTips = (item: DeepPartial<ZodItemType>) => {
  const warnings = [];

  // Warning for canBeCrafted without canBeTraded
  if ((item.canBeCrafted || item.canBeGathered) && !item.canBeTraded) {
    warnings.push({
      type: "warning",
      title: "Trading Recommendation",
      message:
        "Items that can be crafted should typically also be tradeable. Consider enabling 'canBeTraded' for better item economy.",
      color: "orange",
    });
  }

  // Warning for inShop with other acquisition methods
  if (
    item.inShop &&
    (item.isEventItem ||
      item.canBeHunted ||
      item.canBeGathered ||
      item.canBeCrafted ||
      item.canBeTraded)
  ) {
    const enabledMethods = [];
    if (item.isEventItem) enabledMethods.push("Event Item");
    if (item.canBeHunted) enabledMethods.push("Hunting");
    if (item.canBeGathered) enabledMethods.push("Gathering");
    if (item.canBeCrafted) enabledMethods.push("Crafting");
    if (item.canBeTraded) enabledMethods.push("Trading");

    warnings.push({
      type: "warning",
      title: "Shop Availability Question",
      message: `This item is available in the shop but also obtainable through: ${enabledMethods.join(", ")}. Consider if shop availability is necessary when other acquisition methods exist.`,
      color: "yellow",
    });
  }

  if (warnings.length === 0) {
    return (
      <div className="p-3 bg-gray-50 rounded-lg border text-center">
        <p className="text-sm text-gray-600">
          No configuration warnings detected. Item settings look good!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Alert>
        <HelpCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Item Configuration Tips:</strong>
        </AlertDescription>
      </Alert>

      <div className="space-y-3 text-sm">
        {warnings.map((warning, index) => (
          <div
            key={index}
            className={`p-3 rounded-lg border ${
              warning.color === "orange"
                ? "bg-orange-50 border-orange-200"
                : "bg-yellow-50 border-yellow-200"
            }`}
          >
            <h4
              className={`font-medium mb-2 ${
                warning.color === "orange" ? "text-orange-900" : "text-yellow-900"
              }`}
            >
              {warning.title}
            </h4>
            <p
              className={
                warning.color === "orange" ? "text-orange-800" : "text-yellow-800"
              }
            >
              {warning.message}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};
