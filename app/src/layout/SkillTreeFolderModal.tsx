"use client";

import { Check, ChevronLeft, ExternalLink, Lock, X } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { SkillTree, SkillTreeFolder, UserSkill } from "@/drizzle/schema";
import Modal2 from "@/layout/Modal2";
import { parseHtml } from "@/utils/parse";

interface SkillTreeFolderModalProps {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  folder: SkillTreeFolder | null;
  folders: SkillTreeFolder[];
  allSkills: SkillTree[];
  userSkills: (UserSkill & { skill: SkillTree })[];
  userSkillPoints: number;
  onPurchaseSkill: (skillId: string) => void;
  onNavigateToFolder: (folderId: string) => void;
  selectedEffects: string[];
  isPurchasing?: boolean;
}

export const SkillTreeFolderModal: React.FC<SkillTreeFolderModalProps> = ({
  isOpen,
  setIsOpen,
  folder,
  folders,
  allSkills,
  userSkills,
  userSkillPoints,
  onPurchaseSkill,
  onNavigateToFolder,
  selectedEffects,
  isPurchasing,
}) => {
  const [selectedSkill, setSelectedSkill] = useState<SkillTree | null>(null);
  const [navigationHistory, setNavigationHistory] = useState<string[]>([]);

  // Get activated skill IDs
  const activatedSkillIds = userSkills
    .filter((us) => us.activated)
    .map((us) => us.skillId);

  // Get owned skill IDs (activated or not)
  const ownedSkillIds = userSkills.map((us) => us.skillId);

  // Get skills in this folder
  const folderSkills = allSkills.filter((s) => {
    if (!folder) return false;
    if (s.folderId !== folder.id) return false;
    if (s.hidden) return false;
    // Hide SPECIAL skills unless user owns them
    if (s.skillType === "SPECIAL" && !ownedSkillIds.includes(s.id)) return false;
    // Apply effect filter if selected
    if (selectedEffects.length > 0) {
      return s.effects?.some((effect) => selectedEffects.includes(effect.type));
    }
    return true;
  });

  // Group skills by tier
  const skillsByTier: Record<number, SkillTree[]> = {};
  folderSkills.forEach((skill) => {
    if (!skillsByTier[skill.tier]) skillsByTier[skill.tier] = [];
    skillsByTier[skill.tier]?.push(skill);
  });
  const tiers = Object.keys(skillsByTier)
    .map(Number)
    .sort((a, b) => a - b);

  // Skill status helpers
  const getSkillStatus = (skill: SkillTree) => {
    const isOwned = ownedSkillIds.includes(skill.id);
    const isActivated = activatedSkillIds.includes(skill.id);
    const hasPrereqs = skill.requiredSkillIds.every((reqId) =>
      activatedSkillIds.includes(reqId),
    );
    const hasPoints = userSkillPoints >= skill.costSkillPoints;
    const canPurchase = !isActivated && hasPrereqs && hasPoints;

    return { isOwned, isActivated, hasPrereqs, hasPoints, canPurchase };
  };

  // Handle skill click
  const handleSkillClick = (skill: SkillTree) => {
    setSelectedSkill(skill);
  };

  // Handle purchase
  const handlePurchase = () => {
    if (selectedSkill) {
      onPurchaseSkill(selectedSkill.id);
      setSelectedSkill(null);
    }
  };

  // Handle navigating to a prerequisite skill's folder
  const handleNavigateToPrereq = (prereqSkillId: string) => {
    const prereqSkill = allSkills.find((s) => s.id === prereqSkillId);
    if (prereqSkill && prereqSkill.folderId !== folder?.id) {
      if (folder) {
        setNavigationHistory((prev) => [...prev, folder.id]);
      }
      setSelectedSkill(null);
      onNavigateToFolder(prereqSkill.folderId ?? "");
    }
  };

  // Handle back navigation
  const handleBack = () => {
    if (navigationHistory.length > 0) {
      const prevFolderId = navigationHistory[navigationHistory.length - 1];
      setNavigationHistory((prev) => prev.slice(0, -1));
      setSelectedSkill(null);
      if (prevFolderId) {
        onNavigateToFolder(prevFolderId);
      }
    }
  };

  // Close handler
  const handleClose = () => {
    setSelectedSkill(null);
    setNavigationHistory([]);
    setIsOpen(false);
  };

  if (!folder) return null;

  return (
    <Modal2
      title={selectedSkill ? selectedSkill.name : folder.name}
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      onClose={handleClose}
      proceed_label={
        selectedSkill
          ? getSkillStatus(selectedSkill).canPurchase
            ? `Purchase for ${selectedSkill.costSkillPoints} SP`
            : null
          : null
      }
      proceed_loading_label="Purchasing..."
      isLoading={isPurchasing}
      onAccept={
        selectedSkill && getSkillStatus(selectedSkill).canPurchase
          ? handlePurchase
          : undefined
      }
      className="max-w-2xl"
    >
      {/* Back button if viewing skill details or from navigation */}
      {(selectedSkill || navigationHistory.length > 0) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={selectedSkill ? () => setSelectedSkill(null) : handleBack}
          className="mb-4"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          {selectedSkill ? "Back to folder" : "Back"}
        </Button>
      )}

      {/* Skill details view */}
      {selectedSkill ? (
        <SkillDetails
          skill={selectedSkill}
          status={getSkillStatus(selectedSkill)}
          allSkills={allSkills}
          activatedSkillIds={activatedSkillIds}
          onNavigateToPrereq={handleNavigateToPrereq}
          folder={folder}
          folders={folders}
          userSkillPoints={userSkillPoints}
        />
      ) : (
        /* Folder view with skills by tier */
        <div className="space-y-6">
          {/* Folder header */}
          {folder.image && (
            <div className="flex justify-center">
              <div className="relative h-20 w-20 overflow-hidden rounded-lg">
                <Image
                  src={folder.image}
                  alt={folder.name}
                  fill
                  className="object-cover"
                  sizes="80px"
                />
              </div>
            </div>
          )}

          {folder.description && (
            <p className="text-center text-muted-foreground text-sm">
              {folder.description}
            </p>
          )}

          {/* Skills grouped by tier */}
          {tiers.map((tier, i) => (
            <div key={`${tier}-${i}`}>
              <h4 className="mb-2 font-semibold text-muted-foreground text-sm">
                Tier {tier}
              </h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {skillsByTier[tier]?.map((skill) => {
                  const status = getSkillStatus(skill);
                  return (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      status={status}
                      onClick={() => handleSkillClick(skill)}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {folderSkills.length === 0 && (
            <div className="py-8 text-center text-muted-foreground">
              {selectedEffects.length > 0
                ? "No skills in this folder match the selected effects."
                : "No skills in this folder yet."}
            </div>
          )}
        </div>
      )}
    </Modal2>
  );
};

// Skill Card Component
interface SkillCardProps {
  skill: SkillTree;
  status: {
    isOwned: boolean;
    isActivated: boolean;
    hasPrereqs: boolean;
    hasPoints: boolean;
    canPurchase: boolean;
  };
  onClick: () => void;
}

const SkillCard: React.FC<SkillCardProps> = ({ skill, status, onClick }) => {
  const effectivelyOwned = status.isOwned && status.isActivated;
  const isLocked = !effectivelyOwned && !status.hasPrereqs;
  const isUnaffordable = !effectivelyOwned && status.hasPrereqs && !status.hasPoints;
  const isAvailable = !effectivelyOwned && status.hasPrereqs && status.hasPoints;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={isLocked || isUnaffordable}
      className={`relative w-full cursor-pointer rounded-lg border-2 p-3 text-left transition-all duration-200 hover:shadow-md ${
        effectivelyOwned
          ? "border-green-500 bg-green-50 dark:bg-green-950/30"
          : isAvailable
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
            : isUnaffordable
              ? "border-red-500 bg-red-50 dark:bg-red-950/30"
              : "border-border bg-card"
      }
      `}
    >
      {/* Status icon */}
      <div className="absolute -top-2 -right-2">
        {effectivelyOwned && (
          <Check className="h-5 w-5 rounded-full bg-green-500 p-0.5 text-white" />
        )}
        {isLocked && (
          <Lock className="h-5 w-5 rounded-full bg-muted-foreground p-1 text-white" />
        )}
        {isUnaffordable && (
          <X className="h-5 w-5 rounded-full bg-red-500 p-0.5 text-white" />
        )}
      </div>

      {/* Skill image */}
      <div className="mb-2 flex justify-center">
        <div
          className={`relative h-12 w-12 overflow-hidden rounded-full ${isLocked || isUnaffordable ? "opacity-60 grayscale" : ""}`}
        >
          <Image
            src={skill.image}
            alt={skill.name}
            fill
            className="object-cover"
            sizes="48px"
          />
        </div>
      </div>

      {/* Skill name */}
      <p className="truncate text-center font-medium text-xs">{skill.name}</p>

      {/* Badges */}
      <div className="mt-1 flex justify-center gap-1">
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          T{skill.tier}
        </Badge>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          {skill.costSkillPoints} SP
        </Badge>
      </div>
    </button>
  );
};

// Skill Details Component
interface SkillDetailsProps {
  skill: SkillTree;
  status: {
    isOwned: boolean;
    isActivated: boolean;
    hasPrereqs: boolean;
    hasPoints: boolean;
    canPurchase: boolean;
  };
  allSkills: SkillTree[];
  activatedSkillIds: string[];
  onNavigateToPrereq: (skillId: string) => void;
  folder: SkillTreeFolder;
  folders: SkillTreeFolder[];
  userSkillPoints: number;
}

const SkillDetails: React.FC<SkillDetailsProps> = ({
  skill,
  status,
  allSkills,
  activatedSkillIds,
  onNavigateToPrereq,
  folder,
  folders,
  userSkillPoints,
}) => {
  return (
    <div className="space-y-4">
      {/* Skill image and badges */}
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full">
          <Image
            src={skill.image}
            alt={skill.name}
            fill
            className="object-cover"
            sizes="64px"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Tier {skill.tier}</Badge>
          <Badge variant="outline">{skill.costSkillPoints} Skill Points</Badge>
          {status.isOwned && status.isActivated && (
            <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
              <Check className="mr-1 h-3 w-3" />
              Activated
            </Badge>
          )}
          {status.isOwned && !status.isActivated && (
            <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
              <Lock className="mr-1 h-3 w-3" />
              Owned (Inactive)
            </Badge>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="prose prose-sm dark:prose-invert max-w-none text-muted-foreground text-sm">
        {parseHtml(skill.description)}
      </div>

      {/* Prerequisites */}
      {skill.requiredSkillIds.length > 0 && (
        <div>
          <h5 className="mb-2 font-semibold text-sm">Prerequisites:</h5>
          <ul className="space-y-1">
            {skill.requiredSkillIds.map((reqId, i) => {
              const prereq = allSkills.find((s) => s.id === reqId);
              const isPrereqActivated = activatedSkillIds.includes(reqId);
              const isInDifferentFolder = prereq && prereq.folderId !== folder.id;
              const prereqFolder = prereq?.folderId
                ? folders.find((f) => f.id === prereq.folderId)
                : null;

              return (
                <li
                  key={`${reqId}-${i}`}
                  className={`flex items-center gap-2 text-sm ${isPrereqActivated ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
                >
                  {isPrereqActivated ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                  <span>{prereq?.name || reqId}</span>
                  {isInDifferentFolder && prereqFolder && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => onNavigateToPrereq(reqId)}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      {prereqFolder?.name ?? "Uncategorized"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Purchase blockers */}
      {!status.isOwned && !status.isActivated && !status.canPurchase && (
        <div className="flex items-center gap-2 rounded-lg bg-muted p-3">
          <Lock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground text-sm">
            {userSkillPoints < skill.costSkillPoints
              ? `Not enough skill points (need ${skill.costSkillPoints}, have ${userSkillPoints})`
              : "Prerequisites not met"}
          </span>
        </div>
      )}
    </div>
  );
};

export default SkillTreeFolderModal;
