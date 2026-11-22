"use client";

import { Ghost, Loader2, Radar } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  STEALTH_SENSORY_CAP,
  STEALTH_TRAIN_GAIN_PER_MINUTE,
} from "@/drizzle/constants";
import { useLiveCountdown } from "@/hooks/useLiveCountdown";
import type { RevealedPlayer } from "@/hooks/useTravelSession";
import { mapToolClassName } from "@/layout/travel/styles";
import { cn } from "@/libs/shadui";
import { getRemainingSensoryCooldown, getStealthStatus } from "@/libs/stealth";
import { showMutationToast } from "@/libs/toast";
import {
  selectUserWithoutPosition,
  useRequiredUserDataSelector,
} from "@/utils/UserContext";
/** Own stealth and sensory cooldowns so their ticks only render these controls. */
export const StealthControls: React.FC<{
  onRevealed: (players: RevealedPlayer[]) => void;
}> = ({ onRevealed }) => {
  const {
    data: userData,
    timeDiff,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector(selectUserWithoutPosition);
  const currentSector = userData?.sector;
  const activationInFlightRef = useRef(false);
  const deactivationInFlightRef = useRef(false);
  const sensoryInFlightRef = useRef(false);
  const lastSuccessfulSensoryAtRef = useRef<Date | null>(null);
  const [lastSuccessfulSensoryAt, setLastSuccessfulSensoryAt] = useState<Date | null>(
    null,
  );

  const effectiveLastSensoryAt =
    lastSuccessfulSensoryAt &&
    (!userData?.lastSensoryAt ||
      lastSuccessfulSensoryAt.getTime() > userData.lastSensoryAt.getTime())
      ? lastSuccessfulSensoryAt
      : userData?.lastSensoryAt;

  const stealthStatus = userData
    ? getStealthStatus(
        { ...userData, lastSensoryAt: effectiveLastSensoryAt ?? null },
        STEALTH_SENSORY_CAP,
        STEALTH_TRAIN_GAIN_PER_MINUTE,
        timeDiff,
      )
    : undefined;
  const sensoryCooldown = useLiveCountdown(stealthStatus?.sensoryCooldownRemaining);
  const stealthCooldown = useLiveCountdown(stealthStatus?.stealthCooldownRemaining);
  const stealthDuration = useLiveCountdown(stealthStatus?.stealthDurationRemaining);
  // The live duration expires even when the compiler reuses the status snapshot.
  const isCurrentlyStealthed = Boolean(
    stealthStatus?.stealthActive && stealthDuration > 0,
  );

  const { mutate: activateStealth, isPending: isActivatingStealth } =
    api.stealth.activateStealth.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success && data.data) {
          await updateUser(
            {
              stealthActive: true,
              stealthActivatedAt: data.data.stealthActivatedAt,
            },
            { revision, refetch: false, userRecovery: data.userRecovery },
          );
        } else if (data.userRecovery) {
          await updateUser(data, { revision, refetch: false });
        }
      },
      onSettled: () => {
        activationInFlightRef.current = false;
      },
    });

  const { mutate: deactivateStealth, isPending: isDeactivatingStealth } =
    api.stealth.deactivateStealth.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser({ stealthActive: false, stealthActivatedAt: null });
        }
      },
      onSettled: () => {
        deactivationInFlightRef.current = false;
      },
    });

  const { mutate: scanSensory, isPending: isScanningSensory } =
    activateSensory.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success && data.data) {
          lastSuccessfulSensoryAtRef.current = data.data.lastSensoryAt;
          setLastSuccessfulSensoryAt(data.data.lastSensoryAt);
          if (data.data.detectedUsers.length > 0) {
            onRevealed(data.data.detectedUsers);
          }

          // The server has already consumed the scan. Keep cache maintenance best-effort so a
          // client refresh failure cannot hide results or make the Radar appear retryable.
          // Revealed players reach the map through the sector broadcast's arrival read.
          void updateUser(
            { lastSensoryAt: data.data.lastSensoryAt },
            { revision, refetch: false, userRecovery: data.userRecovery },
          ).catch(() => undefined);
        } else if (data.userRecovery) {
          void updateUser(data, { revision, refetch: false });
        }
      },
      onSettled: () => {
        sensoryInFlightRef.current = false;
      },
    });

  return (
    <>
      {/* Stealth Toggle */}
      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger
            type="button"
            disabled={isActivatingStealth || isDeactivatingStealth}
            aria-busy={isActivatingStealth || isDeactivatingStealth}
            aria-disabled={isActivatingStealth || isDeactivatingStealth}
            aria-label={
              isActivatingStealth
                ? "Activating"
                : isDeactivatingStealth
                  ? "Deactivating"
                  : isCurrentlyStealthed
                    ? "Deactivate stealth"
                    : "Activate stealth"
            }
            className={cn(
              mapToolClassName,
              (isActivatingStealth || isDeactivatingStealth) && "cursor-wait",
            )}
            onClick={() => {
              if (
                activationInFlightRef.current ||
                deactivationInFlightRef.current ||
                isActivatingStealth ||
                isDeactivatingStealth
              ) {
                return;
              }
              if (isCurrentlyStealthed) {
                deactivationInFlightRef.current = true;
                deactivateStealth();
              } else if (stealthCooldown <= 0) {
                activationInFlightRef.current = true;
                activateStealth();
              }
            }}
          >
            {isActivatingStealth || isDeactivatingStealth ? (
              <Loader2
                className="h-7 w-7 animate-spin text-purple-500"
                aria-hidden="true"
              />
            ) : (
              <Ghost
                className={`h-7 w-7 ${isCurrentlyStealthed ? "text-purple-500" : stealthCooldown > 0 ? "cursor-not-allowed text-gray-400" : "hover:text-purple-500"}`}
              />
            )}
          </TooltipTrigger>
          <TooltipContent aria-live="polite">
            {isActivatingStealth
              ? "Activating"
              : isDeactivatingStealth
                ? "Deactivating"
                : isCurrentlyStealthed
                  ? `Stealth Active (${Math.ceil(stealthDuration)}s remaining)`
                  : stealthCooldown > 0
                    ? `Stealth Cooldown (${Math.ceil(stealthCooldown)}s)`
                    : "Activate Stealth"}
          </TooltipContent>
        </Tooltip>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {isActivatingStealth
            ? "Activating"
            : isDeactivatingStealth
              ? "Deactivating"
              : ""}
        </span>
      </TooltipProvider>
      {/* Sensory Scan */}
      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <button
                type="button"
                disabled={
                  isScanningSensory ||
                  sensoryCooldown > 0 ||
                  currentSector === undefined
                }
                aria-busy={isScanningSensory}
                aria-disabled={
                  isScanningSensory ||
                  sensoryCooldown > 0 ||
                  currentSector === undefined
                }
                aria-label={isScanningSensory ? "Scanning" : "Scan sector"}
                className={cn(mapToolClassName, isScanningSensory && "cursor-wait")}
                onClick={() => {
                  const successfulScanCooldown = getRemainingSensoryCooldown(
                    lastSuccessfulSensoryAtRef.current,
                    userData?.sensory ?? 0,
                    timeDiff,
                  );
                  if (
                    sensoryInFlightRef.current ||
                    isScanningSensory ||
                    successfulScanCooldown > 0
                  ) {
                    return;
                  }
                  if (sensoryCooldown <= 0) {
                    if (currentSector !== undefined) {
                      sensoryInFlightRef.current = true;
                      scanSensory({ sector: currentSector });
                    }
                  }
                }}
              >
                {isScanningSensory ? (
                  <Loader2
                    className="h-7 w-7 animate-spin text-blue-500"
                    aria-hidden="true"
                  />
                ) : (
                  <Radar
                    className={`h-7 w-7 ${sensoryCooldown > 0 ? "cursor-not-allowed text-gray-400" : "hover:text-blue-500"}`}
                    aria-hidden="true"
                  />
                )}
              </button>
            </span>
          </TooltipTrigger>
          <TooltipContent aria-live="polite">
            {isScanningSensory
              ? "Scanning"
              : sensoryCooldown > 0
                ? `Sensory Cooldown (${Math.ceil(sensoryCooldown)}s)`
                : `Scan for Hidden Enemies (${(stealthStatus?.sensoryDetectChance ?? 5).toFixed(0)}% chance)`}
          </TooltipContent>
        </Tooltip>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {isScanningSensory ? "Scanning" : ""}
        </span>
      </TooltipProvider>
    </>
  );
};

// Alias the procedure so its action name is not interpreted as a React hook.
const activateSensory = api.stealth.useSensory;
