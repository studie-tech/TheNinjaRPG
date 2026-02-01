"use client";

import { useState } from "react";
import Image from "next/image";
import Modal2 from "@/layout/Modal2";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Lock, X, ChevronLeft, ExternalLink } from "lucide-react";
import type { SkillTree, SkillTreeFolder, UserSkill } from "@/drizzle/schema";

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
    skillsByTier[skill.tier]!.push(skill);
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
    const canPurchase = (!isOwned || (isOwned && !isActivated)) && hasPrereqs && hasPoints;

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
    if (prereqSkill?.folderId && prereqSkill.folderId !== folder?.id) {
      if (folder) {
        setNavigationHistory((prev) => [...prev, folder.id]);
      }
      setSelectedSkill(null);
      onNavigateToFolder(prereqSkill.folderId);
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
      onAccept={selectedSkill && getSkillStatus(selectedSkill).canPurchase ? handlePurchase : undefined}
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
          <ChevronLeft className="w-4 h-4 mr-1" />
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
              <div className="relative w-20 h-20 rounded-lg overflow-hidden">
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
            <p className="text-sm text-muted-foreground text-center">{folder.description}</p>
          )}

          {/* Skills grouped by tier */}
          {tiers.map((tier) => (
            <div key={tier}>
              <h4 className="font-semibold text-sm text-muted-foreground mb-2">
                Tier {tier}
              </h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
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
            <div className="text-center py-8 text-muted-foreground">
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
    <div
      onClick={onClick}
      className={`
        relative cursor-pointer rounded-lg border-2 p-3 transition-all duration-200
        hover:shadow-md
        ${effectivelyOwned
          ? "border-green-500 bg-green-50 dark:bg-green-950/30"
          : isAvailable
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
            : isUnaffordable
              ? "border-red-500 bg-red-50 dark:bg-red-950/30"
              : "border-border bg-card"}
      `}
    >
      {/* Status icon */}
      <div className="absolute -top-2 -right-2">
        {effectivelyOwned && (
          <Check className="w-5 h-5 p-0.5 text-white bg-green-500 rounded-full" />
        )}
        {isLocked && (
          <Lock className="w-5 h-5 p-1 text-white bg-muted-foreground rounded-full" />
        )}
        {isUnaffordable && (
          <X className="w-5 h-5 p-0.5 text-white bg-red-500 rounded-full" />
        )}
      </div>

      {/* Skill image */}
      <div className="flex justify-center mb-2">
        <div className={`relative w-12 h-12 rounded-full overflow-hidden ${isLocked || isUnaffordable ? "opacity-60 grayscale" : ""}`}>
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
      <p className="text-xs font-medium text-center truncate">{skill.name}</p>

      {/* Badges */}
      <div className="flex justify-center gap-1 mt-1">
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          T{skill.tier}
        </Badge>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {skill.costSkillPoints} SP
        </Badge>
      </div>
    </div>
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
        <div className="relative w-16 h-16 rounded-full overflow-hidden shrink-0">
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
              <Check className="w-3 h-3 mr-1" />
              Activated
            </Badge>
          )}
          {status.isOwned && !status.isActivated && (
            <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
              <Lock className="w-3 h-3 mr-1" />
              Owned (Inactive)
            </Badge>
          )}
        </div>
      </div>

      {/* Description */}
      <div
        className="text-sm text-muted-foreground prose prose-sm dark:prose-invert max-w-none"
        // eslint-disable-next-line @eslint-react/dom/no-dangerously-set-innerhtml
        dangerouslySetInnerHTML={{ __html: skill.description }}
      />

      {/* Prerequisites */}
      {skill.requiredSkillIds.length > 0 && (
        <div>
          <h5 className="font-semibold text-sm mb-2">Prerequisites:</h5>
          <ul className="space-y-1">
            {skill.requiredSkillIds.map((reqId) => {
              const prereq = allSkills.find((s) => s.id === reqId);
              const isPrereqActivated = activatedSkillIds.includes(reqId);
              const isInDifferentFolder = prereq?.folderId && prereq.folderId !== folder.id;
              const prereqFolder = isInDifferentFolder
                ? folders.find((f) => f.id === prereq?.folderId)
                : null;

              return (
                <li
                  key={reqId}
                  className={`flex items-center gap-2 text-sm ${
                    isPrereqActivated ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                  }`}
                >
                  {isPrereqActivated ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                  <span>{prereq?.name || reqId}</span>
                  {isInDifferentFolder && prereqFolder && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => onNavigateToPrereq(reqId)}
                    >
                      <ExternalLink className="w-3 h-3 mr-1" />
                      {prereqFolder.name}
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
        <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
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
