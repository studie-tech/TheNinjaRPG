"use client";

import { type LucideIcon, ShieldOff, Trash2, Zap } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { MAX_MASS_EXPERIENCE_AWARD } from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import {
  canAwardExperience,
  canClearSectors,
  canEnableGlobalTavern,
  canUnequipAllUsers,
} from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Site Management Functionality
 */
interface ManagementCommandsProps {
  user: NonNullable<UserWithRelations>;
}
/** Expose permission-gated account and world management actions in profile settings. */
export const ManagementCommands: React.FC<ManagementCommandsProps> = ({ user }) => {
  // State for sector selection
  const [sectorNumber, setSectorNumber] = useState<number>(1);
  // State for mass experience award
  const [experienceAmount, setExperienceAmount] = useState<number>(100);

  // Utility
  const utils = api.useUtils();
  const { prepareUserUpdate, updateUser } = useRequiredUserData();

  // Global tavern toggle
  const { data: globalTavernEnabled = true } =
    api.misc.getGlobalTavernEnabled.useQuery();
  const { mutate: toggleGlobalTavern, isPending: isTogglingTavern } =
    api.misc.toggleGlobalTavern.useMutation({
      onSuccess: (result) => {
        showMutationToast(result);
        void utils.misc.getGlobalTavernEnabled.invalidate();
      },
    });

  // Mutations
  const { mutate: unequipAllGear, isPending: isUnequipping } =
    api.staff.unequipAllGear.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _input, revision) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            updateUser(data, { revision }),
            utils.item.getUserItems.invalidate(),
          ]);
        }
      },
    });

  const { mutate: unequipAllJutsus, isPending: isUnequippingJutsus } =
    api.staff.unequipAllJutsus.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _input, revision) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            updateUser(data, { revision }),
            utils.jutsu.getUserJutsus.invalidate(),
          ]);
        }
      },
    });

  const { mutate: releaseSector, isPending: isReleasingSector } =
    api.staff.releaseSector.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            utils.travel.getSectorData.invalidate(),
            utils.village.getSectorOwnerships.invalidate(),
          ]);
        }
      },
    });

  const { mutate: awardExperienceToAll, isPending: isAwardingExperience } =
    api.profile.awardExperienceToAll.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser(undefined, { revision, delta: data.userDelta });
        }
      },
    });

  const { mutate: resetAllUsersSkillPoints, isPending: isResettingSkillTrees } =
    api.skillTree.resetAllUsersSkillPoints.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _input, revision) => {
        showMutationToast(data);
        if (data.success) {
          await Promise.all([
            updateUser(data, { revision }),
            utils.skillTree.getUserSkills.invalidate(),
          ]);
        }
      },
    });

  // Show options
  return (
    <div className="grid grid-cols-3 items-center gap-4 p-4">
      {canUnequipAllUsers(user) && (
        <Confirm
          title="Confirm Unequip All Gear"
          button={
            <StaffCommandButton
              icon={ShieldOff}
              label="Unequip All Gear"
              isPending={isUnequipping}
            />
          }
          onAccept={(e) => {
            e.preventDefault();
            unequipAllGear();
          }}
        >
          This will unequip all currently equipped gear <b>FOR ALL NON-AI USERS</b> and
          clear all of their item loadouts (AI opponents are left unchanged). Are you
          sure you want to continue?
        </Confirm>
      )}
      {canUnequipAllUsers(user) && (
        <Confirm
          title="Confirm Unequip All Jutsus"
          button={
            <StaffCommandButton
              icon={ShieldOff}
              label="Unequip All Jutsus"
              isPending={isUnequippingJutsus}
            />
          }
          onAccept={(e) => {
            e.preventDefault();
            unequipAllJutsus();
          }}
        >
          This will unequip all currently equipped jutsus <b>FOR ALL NON-AI USERS</b>{" "}
          and clear all of their jutsu loadouts (AI opponents are left unchanged). Are
          you sure you want to continue?
        </Confirm>
      )}
      {canUnequipAllUsers(user) && (
        <Confirm
          title="Confirm Reset All Skill Trees"
          button={
            <StaffCommandButton
              icon={Trash2}
              label="Reset All Skill Trees"
              isPending={isResettingSkillTrees}
            />
          }
          onAccept={(e) => {
            e.preventDefault();
            resetAllUsersSkillPoints();
          }}
        >
          This will reset all users&apos; skill trees and refund their skill points{" "}
          <b>FOR ALL USERS</b>. Are you sure you want to continue?
        </Confirm>
      )}
      {canAwardExperience(user) && (
        <Confirm
          title="Confirm Mass Experience Award"
          button={
            <StaffCommandButton
              icon={Zap}
              label="Award Experience to All"
              isPending={isAwardingExperience}
              variant="default"
              className="w-full bg-green-500"
            />
          }
          onAccept={(e) => {
            e.preventDefault();
            awardExperienceToAll({ amount: experienceAmount });
          }}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="experienceAmount">Experience Amount</Label>
              <NumberInput
                id="experienceAmount"
                min={1}
                max={MAX_MASS_EXPERIENCE_AWARD}
                value={experienceAmount}
                onValueChange={setExperienceAmount}
                className="w-32"
              />
            </div>
            {Number.isFinite(experienceAmount) ? (
              <p>
                This will award <b>{experienceAmount}</b> experience points to{" "}
                <b>ALL USERS</b>. Are you sure you want to continue?
              </p>
            ) : (
              <p>Enter a valid experience amount.</p>
            )}
          </div>
        </Confirm>
      )}
      {canClearSectors(user.role) && (
        <Confirm
          title="Confirm Clear Sector"
          button={
            <StaffCommandButton
              icon={Trash2}
              label="Clear Sector"
              isPending={isReleasingSector}
            />
          }
          onAccept={(e) => {
            e.preventDefault();
            releaseSector({ sector: sectorNumber });
          }}
        >
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="sectorNumber">Sector #</Label>
              <NumberInput
                id="sectorNumber"
                min={1}
                value={sectorNumber}
                onValueChange={setSectorNumber}
                className="w-20"
              />
            </div>
            {Number.isFinite(sectorNumber) ? (
              <p>
                This will clear sector <b>{sectorNumber}</b> ownership from the
                database. Are you sure you want to continue?
              </p>
            ) : (
              <p>Enter a valid sector number.</p>
            )}
          </div>
        </Confirm>
      )}
      {canEnableGlobalTavern(user.role) && (
        <div className="flex items-center justify-between gap-2 rounded-md border bg-popover px-3 py-2">
          <Label htmlFor="globalTavernToggle" className="font-medium text-sm">
            Global Tavern
          </Label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {globalTavernEnabled ? "Enabled" : "Disabled"}
            </span>
            <Switch
              id="globalTavernToggle"
              checked={!!globalTavernEnabled}
              onCheckedChange={(checked) => {
                toggleGlobalTavern({ enabled: checked });
              }}
              disabled={isTogglingTavern}
              aria-label="Toggle global tavern"
            />
          </div>
        </div>
      )}
    </div>
  );
};

/** A staff command's Confirm trigger, showing a loader while its mutation runs. */
const StaffCommandButton: React.FC<{
  icon: LucideIcon;
  label: string;
  isPending: boolean;
  variant?: "destructive" | "default";
  className?: string;
}> = ({
  icon: Icon,
  label,
  isPending,
  variant = "destructive",
  className = "w-full",
}) => (
  <Button variant={variant} disabled={isPending} className={className}>
    {isPending ? (
      <Loader size={5} />
    ) : (
      <>
        <Icon className="mr-2 h-4 w-4" />
        {label}
      </>
    )}
  </Button>
);
