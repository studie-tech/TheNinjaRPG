"use client";

import Image from "next/image";
import { Folder } from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
import type { OptionType } from "@/components/ui/multi-select";
import type { SkillTreeFolder, SkillTree } from "@/drizzle/schema";

interface FolderStats {
  folderId: string;
  folderName: string;
  folderImage: string;
  totalSkills: number;
  ownedSkills: number;
}

interface SkillTreeFolderGridProps {
  folders: SkillTreeFolder[];
  folderStats: FolderStats[];
  allSkills: SkillTree[];
  onFolderClick: (folderId: string) => void;
  selectedEffects: string[];
  onEffectsChange: React.Dispatch<React.SetStateAction<string[]>>;
}

export const SkillTreeFolderGrid: React.FC<SkillTreeFolderGridProps> = ({
  folders,
  folderStats,
  allSkills,
  onFolderClick,
  selectedEffects,
  onEffectsChange,
}) => {
  // Get all unique effect types from skills
  const allEffectTypes = Array.from(
    new Set(
      allSkills.flatMap((skill) => skill.effects?.map((effect) => effect.type) || []),
    ),
  ).sort();

  // Filter folders based on whether they contain skills matching the effect filter
  const filteredFolders = folders.filter((folder) => {
    if (selectedEffects.length === 0) return true;

    // Check if any skill in this folder has the selected effects
    const folderSkills = allSkills.filter((s) => s.folderId === folder.id);
    return folderSkills.some((skill) =>
      skill.effects?.some((effect) => selectedEffects.includes(effect.type)),
    );
  });

  // Get stats for a folder
  const getStats = (folderId: string) => {
    return (
      folderStats.find((s) => s.folderId === folderId) || {
        totalSkills: 0,
        ownedSkills: 0,
      }
    );
  };

  return (
    <div className="w-full">
      {/* Filter controls */}
      <div className="mb-4 flex justify-end">
        <div className="w-48">
          <MultiSelect
            options={allEffectTypes.map<OptionType>((t) => ({ label: t, value: t }))}
            selected={selectedEffects}
            onChange={onEffectsChange}
            placeholder="Filter by effect"
          />
        </div>
      </div>

      {/* Folder grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredFolders.map((folder) => {
          const stats = getStats(folder.id);
          const isComplete = stats.ownedSkills === stats.totalSkills && stats.totalSkills > 0;

          return (
            <div
              key={folder.id}
              onClick={() => onFolderClick(folder.id)}
              className={`
                relative cursor-pointer rounded-lg border-2 p-4 transition-all duration-200
                hover:shadow-lg hover:scale-105
                ${isComplete
                  ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                  : "border-border bg-card hover:border-primary"}
              `}
            >
              {/* Folder image or icon */}
              <div className="flex justify-center mb-3">
                {folder.image ? (
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden">
                    <Image
                      src={folder.image}
                      alt={folder.name}
                      fill
                      className="object-cover"
                      sizes="64px"
                    />
                  </div>
                ) : (
                  <Folder className="w-16 h-16 text-muted-foreground" />
                )}
              </div>

              {/* Folder name */}
              <h3 className="text-center font-semibold text-sm truncate">{folder.name}</h3>

              {/* Skill count */}
              <p className={`text-center text-xs mt-1 ${isComplete ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                {stats.ownedSkills}/{stats.totalSkills} skills
              </p>

              {/* Progress bar */}
              {stats.totalSkills > 0 && (
                <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${isComplete ? "bg-green-500" : "bg-primary"}`}
                    style={{ width: `${(stats.ownedSkills / stats.totalSkills) * 100}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredFolders.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          {selectedEffects.length > 0
            ? "No folders contain skills with the selected effects."
            : "No skill folders available yet."}
        </div>
      )}
    </div>
  );
};

export default SkillTreeFolderGrid;
