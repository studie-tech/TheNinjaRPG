"use client";

import { ExternalLink, HelpCircle, Info } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { ZodCombinedQuest } from "@/hooks/quest";
import { findPredecessor } from "@/libs/objectives";
import type { AiRelations } from "@/server/api/routers/ai";
import type { ItemRelations } from "@/server/api/routers/item";
import type { JutsuRelations } from "@/server/api/routers/jutsu";
import { canChangeContent } from "@/utils/permissions";
import type { DeepPartial } from "@/utils/typeutils";
import { useRequiredUserData } from "@/utils/UserContext";
import type {
  ZodAllTags,
  ZodBloodlineType,
  ZodItemType,
  ZodJutsuType,
  ZodSkillTreeType,
} from "@/validators/combat";
import type { AllObjectivesType } from "@/validators/objectives";

export interface QuestHelperProps {
  quest: DeepPartial<ZodCombinedQuest>;
}

export interface ItemHelperProps {
  item: DeepPartial<ZodItemType>;
}

export interface JutsuHelperProps {
  jutsu: DeepPartial<ZodJutsuType>;
}

export interface SkillTreeHelperProps {
  skillTree: DeepPartial<ZodSkillTreeType>;
}

export interface BloodlineHelperProps {
  bloodline: DeepPartial<ZodBloodlineType>;
}

export interface AiHelperProps {
  ai: { userId?: string; username?: string };
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
            <div className="rounded-lg border bg-gray-50 p-3">
              <h3 className="mb-2 font-medium text-gray-900">Quest: {quest.name}</h3>
              <p className="text-gray-600 text-sm capitalize">
                Type: <span className="font-medium">{quest.questType}</span>
              </p>
            </div>

            {renderHuntingTips(quest)}

            {renderGatheringTips(quest)}

            {renderBattlePyramidTips(quest)}

            {renderStarterTips(quest)}

            {renderRaidTips(quest)}

            {quest.questType !== "hunting" &&
              quest.questType !== "gathering" &&
              quest.questType !== "battlepyramid" &&
              quest.questType !== "starter" &&
              quest.questType !== "raid" && (
                <div className="rounded-lg border bg-gray-50 p-3 text-center">
                  <p className="text-gray-600 text-sm">
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
  const itemId = (item as { id?: string })?.id ?? "";
  const { data: itemRelations } = api.item.getItemRelations.useQuery(
    { itemId },
    { enabled: !!itemId },
  );

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
            <div className="rounded-lg border bg-gray-50 p-3">
              <h3 className="mb-2 font-medium text-gray-900">Item: {item.name}</h3>
              <p className="text-gray-600 text-sm capitalize">
                Type: <span className="font-medium">{item.itemType}</span>
              </p>
            </div>
            {renderItemRelations(itemRelations)}
            {renderItemTips(item)}
            {renderItemDescriptionWarnings(item)}
            {item.effects && renderEffectsTips(item.effects as ZodAllTags[])}
            {item.effects &&
              !isItemNoBattleUsage(item) &&
              renderEffectsGraphicsWarning(item.effects as ZodAllTags[])}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export const JutsuHelper: React.FC<JutsuHelperProps> = ({ jutsu }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { data: userData } = useRequiredUserData();

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

  // Load injector counts and references
  const jutsuId = (jutsu as { id?: string })?.id ?? "";
  const { data: injectorData } = api.jutsu.getJutsuRelations.useQuery(
    { jutsuId },
    { enabled: !!jutsuId },
  );

  // Only show if user has permission
  if (!userData) return null;
  if (!canChangeContent(userData.role)) return null;

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
              Jutsu Helper
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="rounded-lg border bg-gray-50 p-3">
              <h3 className="mb-2 font-medium text-gray-900">Jutsu: {jutsu.name}</h3>
              <p className="text-gray-600 text-sm capitalize">
                Rank: <span className="font-medium">{jutsu.jutsuRank}</span>
              </p>
            </div>

            {renderJutsuInformation()}
            {renderJutsuDescriptionWarnings(jutsu)}
            {renderJutseRelations(jutsu, injectorData)}
            {jutsu.effects && renderEffectsTips(jutsu.effects as ZodAllTags[])}
            {jutsu.effects &&
              renderEffectsGraphicsWarning(jutsu.effects as ZodAllTags[])}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export const SkillTreeHelper: React.FC<SkillTreeHelperProps> = ({ skillTree }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { data: userData } = useRequiredUserData();

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

  // Only show if user has permission
  if (!userData) return null;
  if (!canChangeContent(userData.role)) return null;

  return (
    <div>
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
              SkillTree Helper
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="rounded-lg border bg-gray-50 p-3">
              <h3 className="mb-2 font-medium text-gray-900">
                SkillTree: {skillTree.name}
              </h3>
              <p className="text-gray-600 text-sm capitalize">
                Tier: <span className="font-medium">{skillTree.tier ?? 1}</span>
              </p>
              <p className="text-gray-600 text-sm capitalize">
                Target:{" "}
                <span className="font-medium">{skillTree.target ?? "SELF"}</span>
              </p>
            </div>

            {renderSkillTreeWarnings(skillTree)}
            {skillTree.effects && renderEffectsTips(skillTree.effects as ZodAllTags[])}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export const BloodlineHelper: React.FC<BloodlineHelperProps> = ({ bloodline }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { data: userData } = useRequiredUserData();

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

  // Only show if user has permission
  if (!userData) return null;
  if (!canChangeContent(userData.role)) return null;

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
              Bloodline Helper
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="rounded-lg border bg-gray-50 p-3">
              <h3 className="mb-2 font-medium text-gray-900">
                Bloodline: {bloodline.name}
              </h3>
              <p className="text-gray-600 text-sm capitalize">
                Rank: <span className="font-medium">{bloodline.rank}</span>
              </p>
            </div>

            {bloodline.effects && renderEffectsTips(bloodline.effects as ZodAllTags[])}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export const AiHelper: React.FC<AiHelperProps> = ({ ai }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { data: userData } = useRequiredUserData();
  const aiId = ai.userId ?? "";

  useEffect(() => {
    const checkScreenSize = () => {
      const isDesktop = window.innerWidth >= 768;
      setIsOpen(isDesktop);
    };
    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  const { data } = api.ai.getAiRelations.useQuery({ aiId }, { enabled: !!aiId });

  if (!userData) return null;
  if (!canChangeContent(userData.role)) return null;

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
              <HelpCircle className="h-5 w-5" /> AI Helper
            </SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border bg-gray-50 p-3">
              <h3 className="mb-2 font-medium text-gray-900">
                AI: {ai.username ?? ai.userId}
              </h3>
            </div>

            {renderAiRelations(data)}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

/****************************************************  */
/*                RENDERING FUNCTIONS                  */
/****************************************************  */

/**
 * Renders tips for effects-related configuration
 * @param effects - Array of effects to analyze
 * @returns The tips for effects configuration
 */
const renderEffectsTips = (effects: ZodAllTags[]) => {
  const tips = [];

  // Check for injectjutsus effect
  const hasInjectEffect = effects.some((e) => e.type === "injectjutsus");

  if (hasInjectEffect) {
    tips.push(
      <div
        key="injectjutsus-power"
        className="rounded-lg border border-blue-200 bg-blue-50 p-3"
      >
        <h4 className="mb-2 font-medium text-blue-900">Power Attribute</h4>
        <p className="text-blue-800 text-sm">
          The <code className="rounded bg-blue-100 px-1">injectjutsus</code> effect uses
          the
          <code className="rounded bg-blue-100 px-1">power</code> attribute to determine
          the level of the injected jutsu.
        </p>
      </div>,
    );
  }

  // Return null if no tips to show
  if (tips.length === 0) return null;

  return (
    <div className="space-y-3">
      <h4 className="font-medium text-gray-900">Effects Tips</h4>
      {tips}
    </div>
  );
};

/**
 * Returns true if any effect has a visual configured
 */
const hasAnyEffectGraphics = (effects: ZodAllTags[]) => {
  return effects.some(
    (e) =>
      e.appearAnimation ||
      e.disappearAnimation ||
      e.staticAnimation ||
      e.staticAssetPath,
  );
};

/**
 * Single utility: render a graphics warning for a list of effects
 */
const renderEffectsGraphicsWarning = (effects: ZodAllTags[]) => {
  if (effects.length === 0) return null;
  if (hasAnyEffectGraphics(effects)) return null;

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
      <h4 className="mb-2 font-medium text-red-900">Missing Effect Graphics</h4>
      <p className="text-red-800 text-sm">
        No effect visuals configured. Consider adding
        <code className="mr-1 ml-1 rounded bg-red-100 px-1">appearAnimation</code>,{" "}
        <code className="mr-1 rounded bg-red-100 px-1">disappearAnimation</code>,{" "}
        <code className="mr-1 rounded bg-red-100 px-1">staticAnimation</code>
        or <code className="ml-1 rounded bg-red-100 px-1">staticAssetPath</code>
        and optionally <code className="ml-1 rounded bg-red-100 px-1">appearSfx</code>/
        <code className="ml-1 rounded bg-red-100 px-1">disappearSfx</code>
        to at least one effect to improve battle feedback.
      </p>
    </div>
  );
};

/** Item helper: skip graphics warning for items not used in battle */
const isItemNoBattleUsage = (item: DeepPartial<ZodItemType>) => {
  return (
    !!item.preventBattleUsage ||
    ["MATERIAL", "CRYSTAL"].includes((item.itemType as string) || "")
  );
};

/** Jutsu description warnings */
const renderJutsuDescriptionWarnings = (jutsu: DeepPartial<ZodJutsuType>) => {
  const warnings = [] as { title: string; msg: string }[];
  const desc = jutsu.description || "";
  const battleDesc = jutsu.battleDescription || "";

  if (desc.length < 50) {
    warnings.push({
      title: "Short Description",
      msg: "Description is very short. Aim for at least 50 characters for clarity.",
    });
  }
  if (battleDesc.length < 50) {
    warnings.push({
      title: "Short Battle Description",
      msg: "Battle description is very short. Aim for at least 50 characters to explain in-battle behavior.",
    });
  }

  if (warnings.length === 0) return null;
  return (
    <div className="space-y-3">
      {warnings.map((w) => (
        <div key={w.title} className="rounded-lg border border-red-200 bg-red-50 p-3">
          <h4 className="mb-2 font-medium text-red-900">{w.title}</h4>
          <p className="text-red-800 text-sm">{w.msg}</p>
        </div>
      ))}
    </div>
  );
};

/** Item description warnings */
const renderItemDescriptionWarnings = (item: DeepPartial<ZodItemType>) => {
  const warnings = [] as { title: string; msg: string }[];
  const desc = item.description || "";

  if (desc === "New item description") {
    warnings.push({
      title: "Placeholder Description",
      msg: "Item description is still the default placeholder. Please write a proper description.",
    });
  }

  if (warnings.length === 0) return null;
  return (
    <div className="space-y-3">
      {warnings.map((w) => (
        <div key={w.title} className="rounded-lg border border-red-200 bg-red-50 p-3">
          <h4 className="mb-2 font-medium text-red-900">{w.title}</h4>
          <p className="text-red-800 text-sm">{w.msg}</p>
        </div>
      ))}
    </div>
  );
};

/**
 * Renders warnings for skill tree configuration
 * @param skillTree - The skill tree to analyze
 * @returns The warnings for skill tree configuration
 */
const renderSkillTreeWarnings = (skillTree: DeepPartial<ZodSkillTreeType>) => {
  const warnings = [];

  // Check for tier > 1 without prerequisites
  const tier = skillTree.tier ?? 1;
  const requiredSkillIds = skillTree.requiredSkillIds ?? [];

  if (tier > 1 && requiredSkillIds.length === 0) {
    warnings.push(
      <div
        key="tier-prerequisites"
        className="rounded-lg border border-red-200 bg-red-50 p-3"
      >
        <h4 className="mb-2 font-medium text-red-900">Missing Prerequisites</h4>
        <p className="text-red-800 text-sm">
          This skill has tier <code className="rounded bg-red-100 px-1">{tier}</code>{" "}
          but no prerequisite skills are defined. Consider adding required skills to{" "}
          <code className="rounded bg-red-100 px-1">requiredSkillIds</code> for proper
          skill progression.
        </p>
      </div>,
    );
  }

  // Return null if no warnings to show
  if (warnings.length === 0) return null;

  return (
    <div className="space-y-3">
      <h4 className="font-medium text-gray-900">Skill Tree Warnings</h4>
      {warnings}
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
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <h4 className="mb-2 font-medium text-blue-900">Availability</h4>
          <p className="text-blue-800">
            This quest will only be available to hunters with the appropriate hunting
            rank.
          </p>
        </div>

        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <h4 className="mb-2 font-medium text-green-900">Reward Configuration</h4>
          <p className="text-green-800">
            Toggle the{" "}
            <code className="rounded bg-green-100 px-1">reward_hunter_items</code>{" "}
            either on the quest or objective to reward random drops based on hunting
            rank.
            <br />
            <br />
            You can also set the{" "}
            <code className="rounded bg-green-100 px-1">reward_hunter_items_ids</code>{" "}
            to reward randomly from a list of specific items. If{" "}
            <code className="rounded bg-green-100 px-1">reward_hunter_items_ids</code>{" "}
            is not set, items will be selected from all hunter materials.
          </p>
        </div>

        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
          <h4 className="mb-2 font-medium text-purple-900">Location Encounters</h4>
          <p className="text-purple-800">
            Use the{" "}
            <code className="rounded bg-purple-100 px-1">
              win_encounter_at_location
            </code>{" "}
            objective to send off the user to win random encounters at specific
            locations.
          </p>
        </div>

        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
          <h4 className="mb-2 font-medium text-orange-900">Combat Configuration</h4>
          <p className="text-orange-800">
            Add multiple attackers with random encounter chances. Set the{" "}
            <code className="rounded bg-orange-100 px-1">attackers_max_per_battle</code>{" "}
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
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <h4 className="mb-2 font-medium text-blue-900">Objective Type</h4>
          <p className="text-blue-800">
            Use the <code className="rounded bg-blue-100 px-1">collect_item</code>{" "}
            objective to set up gathering requirements.
          </p>
        </div>

        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <h4 className="mb-2 font-medium text-green-900">Reward Configuration</h4>
          <p className="text-green-800">
            Toggle the{" "}
            <code className="rounded bg-green-100 px-1">reward_gathering_items</code>{" "}
            either on the quest or objective to reward random drops based on gathering
            rank.
            <br />
            <br />
            You can also set the{" "}
            <code className="rounded bg-green-100 px-1">
              reward_gathering_items_ids
            </code>{" "}
            to reward randomly from a list of specific items. If{" "}
            <code className="rounded bg-green-100 px-1">
              reward_gathering_items_ids
            </code>{" "}
            is not set, items will be selected from all gathering materials.
          </p>
        </div>

        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
          <h4 className="mb-2 font-medium text-purple-900">Random Drops</h4>
          <p className="text-purple-800">
            Do not set{" "}
            <code className="rounded bg-purple-100 px-1">collectItemIds</code> if you
            only want random drops from gathering activities.
          </p>
        </div>

        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
          <h4 className="mb-2 font-medium text-orange-900">Collection Time</h4>
          <p className="text-orange-800">
            Set the{" "}
            <code className="rounded bg-orange-100 px-1">collect_time_minutes</code> to
            configure how long each collection action takes.
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * Renders the tips for battle pyramid quests
 * @param quest - The quest to render the tips for
 * @returns The tips for battle pyramid quests
 */
const renderBattlePyramidTips = (quest: DeepPartial<ZodCombinedQuest>) => {
  if (quest.questType !== "battlepyramid") return null;

  // Find the first objective (the one with no predecessors)
  const objectives = (quest.content?.objectives || []) as AllObjectivesType[];
  const firstObjective = objectives.find((obj) => !findPredecessor(objectives, obj.id));

  // Check for invalid objective types
  const allowedTypes = ["dialog", "start_battle", "reset_quest"];
  const invalidObjectives = objectives.filter(
    (obj) => !allowedTypes.includes(obj.task),
  );

  // Check start_battle objectives for proper failObjectiveId
  const startBattleObjectives = objectives.filter((obj) => obj.task === "start_battle");
  const resetQuestObjective = objectives.find((obj) => obj.task === "reset_quest");
  const startBattleWithoutProperFail = startBattleObjectives.filter((obj) => {
    const failId = (obj as { failObjectiveId?: string }).failObjectiveId;
    return !failId || failId !== resetQuestObjective?.id;
  });

  return (
    <div className="space-y-4">
      <Alert>
        <HelpCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Battle Pyramid Quest Tips:</strong>
        </AlertDescription>
      </Alert>

      <div className="space-y-3 text-sm">
        {/* Warning for first objective not being dialog */}
        {firstObjective && firstObjective.task !== "dialog" && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <h4 className="mb-2 font-medium text-red-900">⚠️ First Objective Warning</h4>
            <p className="text-red-800">
              The first objective should be a{" "}
              <code className="rounded bg-red-100 px-1">dialog</code> task to provide
              context and introduction to the pyramid challenge. Currently, the first
              objective is set to{" "}
              <code className="rounded bg-red-100 px-1">{firstObjective.task}</code>.
            </p>
          </div>
        )}

        {/* Warning for invalid objective types */}
        {invalidObjectives.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <h4 className="mb-2 font-medium text-red-900">⚠️ Invalid Objective Types</h4>
            <p className="text-red-800">
              Battle pyramid quests should only contain{" "}
              <code className="rounded bg-red-100 px-1">dialog</code>,
              <code className="rounded bg-red-100 px-1">start_battle</code>, or
              <code className="rounded bg-red-100 px-1">reset_quest</code> objectives.
              Found invalid types:{" "}
              {invalidObjectives.map((obj) => (
                <code key={obj.id} className="mx-1 rounded bg-red-100 px-1">
                  {obj.task}
                </code>
              ))}
            </p>
          </div>
        )}

        {/* Error for start_battle objectives without proper failObjectiveId */}
        {startBattleWithoutProperFail.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <h4 className="mb-2 font-medium text-red-900">
              🚨 Missing Failure Configuration
            </h4>
            <p className="text-red-800">
              All <code className="rounded bg-red-100 px-1">start_battle</code>{" "}
              objectives must have a
              <code className="rounded bg-red-100 px-1">failObjectiveId</code> field
              pointing to the
              <code className="rounded bg-red-100 px-1">reset_quest</code> objective.
              {!resetQuestObjective && (
                <span className="mt-1 block">
                  <strong>Additionally, no reset_quest objective was found.</strong>
                </span>
              )}
              Objectives missing proper failure configuration:{" "}
              {startBattleWithoutProperFail.map((obj) => (
                <code key={obj.id} className="mx-1 rounded bg-red-100 px-1">
                  {obj.id}
                </code>
              ))}
            </p>
          </div>
        )}

        {/* Info for reset_quest objective without resetObjectiveId */}
        {resetQuestObjective && !resetQuestObjective.resetObjectiveId && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <h4 className="mb-2 font-medium text-blue-900">ℹ️ Quest Reset Behavior</h4>
            <p className="text-blue-800">
              The <code className="rounded bg-blue-100 px-1">reset_quest</code>{" "}
              objective does not have a{" "}
              <code className="rounded bg-blue-100 px-1">resetObjectiveId</code> field.
              This means when triggered, the entire quest will be reset to the
              beginning, allowing players to restart the full pyramid challenge.
            </p>
          </div>
        )}

        {/* Warning for consecutiveObjectives */}
        {quest.consecutiveObjectives !== true && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <h4 className="mb-2 font-medium text-red-900">⚠️ Configuration Warning</h4>
            <p className="text-red-800">
              The <code className="rounded bg-red-100 px-1">consecutiveObjectives</code>{" "}
              setting should be enabled (true) for battle pyramid quests to ensure
              proper progression through the pyramid levels.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <h4 className="mb-2 font-medium text-blue-900">ℹ️ Objective Structure</h4>
          <p className="text-blue-800">
            Battle pyramid quests work best with a series of{" "}
            <code className="rounded bg-blue-100 px-1">start_battle</code> objectives,
            each representing a different level of the pyramid.
          </p>
        </div>

        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <h4 className="mb-2 font-medium text-green-900">Failure Handling</h4>
          <p className="text-green-800">
            Configure all pyramid level objectives to point back to the first objective
            on failure (or to a given checkpoint). This ensures players restart from the
            checkpoint if they lose at any level, maintaining the pyramid challenge
            structure.
          </p>
        </div>

        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
          <h4 className="mb-2 font-medium text-purple-900">Progressive Difficulty</h4>
          <p className="text-purple-800">
            Each subsequent objective should represent a more challenging battle,
            creating a progressive difficulty curve that defines the pyramid structure.
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * Renders the tips for starter quests
 * @param quest - The quest to render the tips for
 * @returns The tips for starter quests
 */
const renderStarterTips = (quest: DeepPartial<ZodCombinedQuest>) => {
  if (quest.questType !== "starter") return null;

  const hasPrerequisite = !!quest.prerequisiteQuestId;

  return (
    <div className="space-y-4">
      <Alert>
        <HelpCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Starter Quest Tips:</strong>
        </AlertDescription>
      </Alert>

      <div className="space-y-3 text-sm">
        {/* Warning for missing prerequisite */}
        {!hasPrerequisite && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <h4 className="mb-2 font-medium text-red-900">
              ⚠️ Missing Prerequisite Quest
            </h4>
            <p className="text-red-800">
              This starter quest does not have a prerequisite quest set. Consider
              linking starter quests together using the{" "}
              <code className="rounded bg-red-100 px-1">prerequisiteQuestId</code> field
              to create a guided progression for new players.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <h4 className="mb-2 font-medium text-blue-900">Quest Progression</h4>
          <p className="text-blue-800">
            Starter quests should be linked together with prerequisites to create a
            logical learning progression. This prevents new players from being
            overwhelmed with too many quest choices at once.
          </p>
        </div>

        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <h4 className="mb-2 font-medium text-green-900">Best Practices</h4>
          <p className="text-green-800">
            • Link each starter quest to the previous one using{" "}
            <code className="rounded bg-green-100 px-1">prerequisiteQuestId</code>
            <br />• Create a clear tutorial flow that introduces game mechanics
            gradually
            <br />• Consider the difficulty curve and ensure each quest builds upon the
            last
          </p>
        </div>

        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
          <h4 className="mb-2 font-medium text-purple-900">New Player Experience</h4>
          <p className="text-purple-800">
            Well-structured starter quests with proper prerequisites, clear descriptions
            and guidelines create a smooth onboarding experience and help retain new
            players by providing clear direction without overwhelming choice paralysis.
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * Renders the tips for raid quests
 * @param quest - The quest to render the tips for
 * @returns The tips for raid quests
 */
const renderRaidTips = (quest: DeepPartial<ZodCombinedQuest>) => {
  if (quest.questType !== "raid") return null;

  const objectives = (quest.content?.objectives || []) as AllObjectivesType[];
  const objective = objectives[0];
  const objectiveTask = objective?.task;

  // Check configuration status
  const hasValidObjectiveType =
    objectiveTask === "open_raid" || objectiveTask === "exclusive_raid";
  const hasBossHealth = quest.raidBossMaxHealth && quest.raidBossMaxHealth > 0;
  const hasCurrentHealth =
    quest.raidBossCurrentHealth !== null && quest.raidBossCurrentHealth !== undefined;
  const opponentAIs = (objective as { opponentAIs?: { ids?: string[] }[] })
    ?.opponentAIs;
  const hasBossAI =
    opponentAIs &&
    opponentAIs.length > 0 &&
    opponentAIs.some((ai) => (ai.ids?.length ?? 0) > 0);
  const sector = (objective as { sector?: number })?.sector;
  const hasSector = sector !== null && sector !== undefined;

  return (
    <div className="space-y-4">
      <Alert>
        <HelpCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>Raid Quest Setup Guide:</strong>
        </AlertDescription>
      </Alert>

      <div className="space-y-3 text-sm">
        {/* Configuration checklist */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <h4 className="mb-2 font-medium text-blue-900">Configuration Checklist</h4>
          <div className="space-y-1 text-blue-800">
            <p className={hasValidObjectiveType ? "text-green-700" : "text-red-700"}>
              {hasValidObjectiveType ? "✓" : "✗"} Objective type:{" "}
              <code className="rounded bg-blue-100 px-1">open_raid</code> or{" "}
              <code className="rounded bg-blue-100 px-1">exclusive_raid</code>
            </p>
            <p className={hasBossAI ? "text-green-700" : "text-red-700"}>
              {hasBossAI ? "✓" : "✗"} Boss AI configured in{" "}
              <code className="rounded bg-blue-100 px-1">opponentAIs</code> (in
              objective)
            </p>
            <p className={hasSector ? "text-green-700" : "text-red-700"}>
              {hasSector ? "✓" : "✗"} Sector number set via{" "}
              <code className="rounded bg-blue-100 px-1">sector</code> (in objective)
            </p>
            <p className={hasBossHealth ? "text-green-700" : "text-red-700"}>
              {hasBossHealth ? "✓" : "✗"} Boss max health via{" "}
              <code className="rounded bg-blue-100 px-1">raidBossMaxHealth</code> (quest
              field)
            </p>
            <p className={hasCurrentHealth ? "text-green-700" : "text-red-700"}>
              {hasCurrentHealth ? "✓" : "✗"} Boss current health via{" "}
              <code className="rounded bg-blue-100 px-1">raidBossCurrentHealth</code>{" "}
              (quest field)
            </p>
          </div>
        </div>

        {/* Warning if objectives count is wrong */}
        {objectives.length !== 1 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <h4 className="mb-2 font-medium text-red-900">⚠️ Objective Count Error</h4>
            <p className="text-red-800">
              Raid quests must have exactly <strong>one</strong> objective. Currently
              there are {objectives.length} objectives.
            </p>
          </div>
        )}

        {/* Warning if wrong objective type */}
        {objectiveTask && !hasValidObjectiveType && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <h4 className="mb-2 font-medium text-red-900">⚠️ Invalid Objective Type</h4>
            <p className="text-red-800">
              The objective type is{" "}
              <code className="rounded bg-red-100 px-1">{objectiveTask}</code>. Raid
              quests must use either{" "}
              <code className="rounded bg-red-100 px-1">open_raid</code> or{" "}
              <code className="rounded bg-red-100 px-1">exclusive_raid</code>.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-green-200 bg-green-50 p-3">
          <h4 className="mb-2 font-medium text-green-900">Open Raids</h4>
          <p className="text-green-800">
            <strong>Availability:</strong> Open to all players regardless of village
            affiliation.
            <br />
            <br />
            <strong>Objective:</strong> Use{" "}
            <code className="rounded bg-green-100 px-1">open_raid</code> objective type.
            <br />
            <br />
            <strong>Sector:</strong> Takes place at a specific sector (visual/thematic).
          </p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h4 className="mb-2 font-medium text-amber-900">Exclusive Raids</h4>
          <p className="text-amber-800">
            <strong>Trigger:</strong> Spawns when a village/faction captures the
            specified sector.
            <br />
            <br />
            <strong>Participation:</strong> Only members of the village/faction that
            owns the sector can participate.
            <br />
            <br />
            <strong>Win Condition:</strong> Defeat the boss before{" "}
            <code className="rounded bg-amber-100 px-1">raidEndsAt</code> →{" "}
            <span className="font-semibold">Village keeps the sector shrine</span>
            <br />
            <br />
            <strong>Fail Condition:</strong> Boss not defeated in time →{" "}
            <span className="font-semibold">
              Sector becomes neutral (Syndicate control)
            </span>
            <br />
            <br />
            <strong>Objective:</strong> Use{" "}
            <code className="rounded bg-amber-100 px-1">exclusive_raid</code> task with
            the sector number and opponent AI configured.
          </p>
        </div>

        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
          <h4 className="mb-2 font-medium text-purple-900">Boss Configuration</h4>
          <p className="text-purple-800">
            The boss AI is configured via the{" "}
            <code className="rounded bg-purple-100 px-1">opponentAIs</code> field in the
            objective. Select an AI that has an AI Profile configured.
            <br />
            <br />
            Boss HP is shared across all battles and is tracked via{" "}
            <code className="rounded bg-purple-100 px-1">raidBossMaxHealth</code> and{" "}
            <code className="rounded bg-purple-100 px-1">raidBossCurrentHealth</code> on
            the quest itself.
          </p>
        </div>

        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
          <h4 className="mb-2 font-medium text-orange-900">Sector Requirement</h4>
          <p className="text-orange-800">
            Both open and exclusive raids require a{" "}
            <code className="rounded bg-orange-100 px-1">sector</code> in the objective.
            This determines where the raid takes place on the map.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <h4 className="mb-2 font-medium text-gray-900">Damage Thresholds</h4>
          <p className="text-gray-800">
            After creating the raid quest, you can configure damage threshold rewards
            through the database. Players who deal enough cumulative damage across
            battles can claim these rewards.
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
      <div className="rounded-lg border bg-gray-50 p-3 text-center">
        <p className="text-gray-600 text-sm">
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
        {warnings.map((warning) => (
          <div
            key={warning.title}
            className={`rounded-lg border p-3 ${warning.color === "orange" ? "border-orange-200 bg-orange-50" : "border-yellow-200 bg-yellow-50"}`}
          >
            <h4
              className={`mb-2 font-medium ${warning.color === "orange" ? "text-orange-900" : "text-yellow-900"}`}
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

/**
 * Renders the tips for jutsu information
 * @param jutsu - The jutsu to render the tips for
 * @returns The tips for jutsu information
 */
const renderJutsuInformation = () => {
  return (
    <>
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <h4 className="mb-2 font-medium text-blue-900">Injectable In Battle</h4>
        <p className="text-blue-800 text-sm">
          The <code className="rounded bg-blue-100 px-1">injectableInBattle</code> field
          determines whether this jutsu can be injected by other effects.
        </p>
      </div>
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <h4 className="mb-2 font-medium text-blue-900">Pick a target</h4>
        <p className="text-blue-800 text-sm">
          The <code className="rounded bg-blue-100 px-1">target</code> field determines
          the target of this jutsu.
        </p>
      </div>
    </>
  );
};

const renderJutseRelations = (
  _jutsu: DeepPartial<ZodJutsuType>,
  relations?: JutsuRelations,
) => {
  if (!relations) return null;

  const {
    jutsuInjectors,
    bloodlineInjectors,
    skillInjectors,
    itemInjectors,
    aiUsingJutsu,
    questsUsingJutsu,
  } = relations;

  // Define relation configurations with their specific routes
  const relationConfigs = [
    {
      name: "Injector Jutsus",
      data: jutsuInjectors,
      route: "/manual/jutsu/edit",
    },
    {
      name: "Injector Bloodlines",
      data: bloodlineInjectors,
      route: "/manual/bloodline/edit",
    },
    {
      name: "Injector Skills",
      data: skillInjectors,
      route: "/manual/skillTree/edit",
    },
    {
      name: "Injector Items",
      data: itemInjectors,
      route: "/manual/item/edit",
    },
    {
      name: "AI Users",
      data: aiUsingJutsu,
      route: "/manual/ai/edit",
    },
    {
      name: "Quests Using Jutsu",
      data: questsUsingJutsu,
      route: "/manual/quest/edit",
    },
  ];

  const totalRelations = relationConfigs.reduce(
    (sum, config) => sum + config.data.length,
    0,
  );

  /**
   * Renders a section for a specific relation type
   */
  const renderRelationSection = (config: (typeof relationConfigs)[0]) => {
    if (config.data.length === 0) return null;

    return (
      <div key={config.name}>
        <h5 className="mb-1 font-medium text-gray-700 text-sm">
          {config.name} ({config.data.length})
        </h5>
        <div className="space-y-1">
          {config.data.map((ref) => (
            <div key={ref.id} className="flex items-center justify-between text-sm">
              <span>{ref.name}</span>
              {config.route && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => window.open(`${config.route}/${ref.id}`, "_blank")}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  // Return null if no relations exist
  if (totalRelations === 0) return null;

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-gray-900">Jutsu Relations</h4>

      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center gap-2">
            <span>
              Total relations found:{" "}
              <span className="font-medium">{totalRelations}</span>
            </span>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                  <Info className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80">
                <div className="space-y-3">
                  <h4 className="font-medium">Related Content</h4>
                  {relationConfigs.map(renderRelationSection)}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="mt-1 space-y-0.5 text-gray-700 text-xs">
            {relationConfigs.map((config) =>
              config.data.length > 0 ? (
                <p key={config.name}>
                  • {config.name}: {config.data.length}
                </p>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const renderAiRelations = (relations?: AiRelations) => {
  if (!relations) return null;
  const { questsUsingAi } = relations;
  if (!questsUsingAi || questsUsingAi.length === 0) return null;

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-gray-900">AI Relations</h4>
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center gap-2">
            <span>
              Quests including this AI:{" "}
              <span className="font-medium">{questsUsingAi.length}</span>
            </span>
          </div>
          <div className="mt-1 space-y-0.5 text-gray-700 text-xs">
            {questsUsingAi.map((q) => (
              <div key={q.id} className="flex items-center justify-between">
                <span>{q.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => window.open(`/manual/quest/edit/${q.id}`, "_blank")}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const renderItemRelations = (relations?: ItemRelations) => {
  if (!relations) return null;
  const { aiEquippedItem, questsUsingItem } = relations;
  const sections = [
    { name: "AI Equipped", data: aiEquippedItem, route: "/manual/ai/edit" },
    { name: "Quests Using Item", data: questsUsingItem, route: "/manual/quest/edit" },
  ];

  const total = sections.reduce((n, s) => n + (s.data?.length ?? 0), 0);
  if (total === 0) return null;

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-gray-900">Item Relations</h4>
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="mt-1 space-y-1 text-gray-700 text-xs">
            {sections.map((s) =>
              s.data && s.data.length > 0 ? (
                <div key={s.name}>
                  <h5 className="mb-1 font-medium text-gray-700 text-sm">
                    {s.name} ({s.data.length})
                  </h5>
                  <div className="space-y-1">
                    {s.data.map((ref) => (
                      <div key={ref.id} className="flex items-center justify-between">
                        <span>{ref.name}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => window.open(`${s.route}/${ref.id}`, "_blank")}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
