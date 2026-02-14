"use client";

import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IMG_ICON_HEAL } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import Image from "@/layout/Image";
import { calcCurrent } from "@/layout/StatusBar";
import { calcChakraToPools } from "@/libs/hospital";
import type { SectorUser } from "@/libs/threejs/types";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";

/**
 * A reusable healing popover component that allows medical ninja to heal other users.
 *
 * @example
 * ```tsx
 * // Controlled mode (external state)
 * <HealingPopover
 *   targetUser={user}
 *   userData={userData}
 *   timeDiff={timeDiff}
 *   updateUser={updateUser}
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   side="top"
 *   onHealComplete={() => console.log('Healing completed!')}
 * />
 *
 * // Uncontrolled mode (internal state with trigger)
 * <HealingPopover
 *   targetUser={user}
 *   userData={userData}
 *   timeDiff={timeDiff}
 *   updateUser={updateUser}
 *   side="top"
 *   onHealComplete={() => console.log('Healing completed!')}
 * />
 * ```
 */
interface HealingPopoverProps {
  /** The user to be healed */
  targetUser: SectorUser;
  /** The current user's data */
  userData: NonNullable<UserWithRelations>;
  /** Time difference for regeneration calculations */
  timeDiff: number;
  /** Function to update the user's data */
  updateUser: (data: Partial<NonNullable<UserWithRelations>>) => Promise<void>;
  /** Custom trigger element. If not provided, uses default heal icon */
  trigger?: React.ReactNode;
  /** Side where the popover should appear relative to the trigger */
  side?: "top" | "bottom" | "left" | "right";
  /** Additional CSS classes for the popover content */
  className?: string;
  /** Callback function called when healing is completed successfully */
  onHealComplete?: () => void;
  /** Control the open state externally (controlled mode) */
  open?: boolean;
  /** Callback for when open state changes (controlled mode) */
  onOpenChange?: (open: boolean) => void;
}

const HealingPopover: React.FC<HealingPopoverProps> = ({
  targetUser,
  userData,
  timeDiff,
  updateUser,
  trigger,
  side = "top",
  className = "",
  onHealComplete,
  open,
  onOpenChange,
}) => {
  const utils = api.useUtils();

  // Mutations
  const { mutate: userHeal, isPending: isHealing } = api.hospital.userHeal.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      if (data.success) {
        await Promise.all([
          updateUser({
            curChakra: userData.curChakra - (data.chakraCost || 0),
            medicalExperience: userData.medicalExperience + (data.expGain || 0),
          }),
          utils.village.getAll.invalidate(),
        ]);
        onHealComplete?.();
      }
    },
  });

  // Helper function to calculate healing capacity
  const calcHealCapacity = (user: SectorUser) => {
    const currentChakra = calcCurrent(
      userData.curChakra,
      userData.maxChakra,
      userData.status,
      userData.regeneration,
      userData.regenAt,
      timeDiff,
    ).current;

    const maxHeal = calcChakraToPools(userData, currentChakra);
    const missingHealth = user.maxHealth - user.curHealth;
    return { maxHeal, missingHealth };
  };

  const { maxHeal, missingHealth } = calcHealCapacity(targetUser);

  const defaultTrigger = (
    <Image
      src={IMG_ICON_HEAL}
      width={40}
      height={40}
      alt={`Heal-${targetUser.userId}`}
      className="cursor-pointer"
    />
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger || defaultTrigger}</PopoverTrigger>
      <PopoverContent className={`w-80 ${className}`} side={side}>
        <div className="space-y-4">
          <div className="text-center">
            <AvatarImage
              href={targetUser.avatar}
              userId={targetUser.userId}
              alt={targetUser.username}
              size={60}
              priority
            />
            <p className="mt-2 font-semibold">{targetUser.username}</p>
            <p className="text-gray-600 text-sm">
              Health: {Math.floor(targetUser.curHealth)}/{targetUser.maxHealth}
            </p>
            <p className="text-gray-600 text-sm">
              Your max heal capacity: {Math.floor(maxHeal)} HP
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={
                targetUser.maxHealth * 0.25 > maxHeal || isHealing || missingHealth <= 0
              }
              onClick={() =>
                userHeal({ userId: targetUser.userId, healPercentage: 25 })
              }
              className="w-full"
            >
              25%
            </Button>
            <Button
              disabled={
                targetUser.maxHealth * 0.5 > maxHeal ||
                missingHealth <= 0.25 * targetUser.maxHealth ||
                isHealing
              }
              onClick={() =>
                userHeal({ userId: targetUser.userId, healPercentage: 50 })
              }
              className="w-full"
            >
              50%
            </Button>
            <Button
              disabled={
                targetUser.maxHealth * 0.75 > maxHeal ||
                missingHealth <= 0.5 * targetUser.maxHealth ||
                isHealing
              }
              onClick={() =>
                userHeal({ userId: targetUser.userId, healPercentage: 75 })
              }
              className="w-full"
            >
              75%
            </Button>
            <Button
              disabled={
                targetUser.maxHealth * 1.0 > maxHeal ||
                missingHealth <= 0.75 * targetUser.maxHealth ||
                isHealing
              }
              onClick={() =>
                userHeal({ userId: targetUser.userId, healPercentage: 100 })
              }
              className="w-full"
            >
              100%
            </Button>
          </div>

          {isHealing && (
            <div className="text-center">
              <p className="text-gray-600 text-sm">Healing in progress...</p>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default HealingPopover;
