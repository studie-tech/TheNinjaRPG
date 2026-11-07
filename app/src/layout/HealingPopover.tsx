"use client";

import type React from "react";
import { api } from "@/app/_trpc/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IMG_ICON_HEAL } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import {
  currentHealCapacity,
  HealPercentageButtons,
} from "@/layout/HealPercentageButtons";
import Image from "@/layout/Image";
import type { SectorUser } from "@/libs/sector-map/world-types";
import { showMutationToast } from "@/libs/toast";
import { useUserData } from "@/utils/UserContext";

/**
 * A reusable healing popover component that allows medical ninja to heal other users.
 *
 * @example
 * ```tsx
 * // Controlled mode (external state)
 * <HealingPopover
 *   targetUser={user}
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   side="top"
 *   onHealComplete={() => console.log('Healing completed!')}
 * />
 *
 * // Uncontrolled mode (internal state with trigger)
 * <HealingPopover
 *   targetUser={user}
 *   side="top"
 *   onHealComplete={() => console.log('Healing completed!')}
 * />
 * ```
 */
interface HealingPopoverProps {
  /** The user to be healed */
  targetUser: SectorUser;
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
  trigger,
  side = "top",
  className = "",
  onHealComplete,
  open,
  onOpenChange,
}) => {
  const utils = api.useUtils();
  const { data: userData, timeDiff, prepareUserUpdate, updateUser } = useUserData();

  // Mutations
  const { mutate: userHeal, isPending: isHealing } = api.hospital.userHeal.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _variables, revision) => {
      showMutationToast(data);
      if (!data.success && data.userRecovery) await updateUser(data, { revision });
      if (data.success) {
        await Promise.all([
          updateUser(data.healer, { revision, userRecovery: data.userRecovery }),
          utils.village.getAll.invalidate(),
        ]);
        onHealComplete?.();
      }
    },
  });

  if (!userData) return null;

  const maxHeal = currentHealCapacity(userData, timeDiff);
  const missingHealth = targetUser.maxHealth - targetUser.curHealth;

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

          <HealPercentageButtons
            className="gap-2"
            buttonProps={{ className: "w-full" }}
            maxHealth={targetUser.maxHealth}
            missingHealth={missingHealth}
            maxHeal={maxHeal}
            disabled={isHealing || missingHealth <= 0}
            onHeal={(healPercentage) =>
              userHeal({ userId: targetUser.userId, healPercentage })
            }
          />

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
