"use client";

import { Ghost, Loader2, Radar } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import {
  STEALTH_SENSORY_CAP,
  STEALTH_TRAIN_GAIN_PER_MINUTE,
} from "@/drizzle/constants";
import { useLiveCountdown } from "@/hooks/useLiveCountdown";
import type { RevealedPlayer } from "@/hooks/useTravelSession";
import { mapIconToolClassName, mapToolClassName } from "@/layout/travel/styles";
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
  asMenu?: boolean;
}> = ({ onRevealed, asMenu = true }) => {
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
      <button
        type="button"
        disabled={
          isActivatingStealth ||
          isDeactivatingStealth ||
          (!isCurrentlyStealthed && stealthCooldown > 0)
        }
        title={
          isCurrentlyStealthed
            ? `Stealth active (${Math.ceil(stealthDuration)}s remaining)`
            : stealthCooldown > 0
              ? `Stealth cooldown (${Math.ceil(stealthCooldown)}s)`
              : "Activate stealth"
        }
        aria-busy={isActivatingStealth || isDeactivatingStealth}
        aria-pressed={isCurrentlyStealthed}
        aria-label={isCurrentlyStealthed ? "Deactivate stealth" : "Activate stealth"}
        className={cn(
          asMenu ? mapToolClassName : mapIconToolClassName,
          isCurrentlyStealthed && "text-purple-500",
        )}
        onClick={() => {
          if (
            activationInFlightRef.current ||
            deactivationInFlightRef.current ||
            isActivatingStealth ||
            isDeactivatingStealth
          )
            return;
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
          <Loader2 className="size-6 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Ghost className="size-6 shrink-0" aria-hidden />
        )}
        <span className={asMenu ? "min-w-0" : "sr-only"}>
          <span className="block text-sm font-semibold">
            {isCurrentlyStealthed ? "Deactivate stealth" : "Activate stealth"}
          </span>
          <span className="text-muted-foreground block text-xs" role="status">
            {isActivatingStealth
              ? "Activating…"
              : isDeactivatingStealth
                ? "Deactivating…"
                : isCurrentlyStealthed
                  ? `Hidden · ${Math.ceil(stealthDuration)}s remaining`
                  : stealthCooldown > 0
                    ? `Ready in ${Math.ceil(stealthCooldown)}s`
                    : "Hide from other players"}
          </span>
        </span>
      </button>
      <button
        type="button"
        disabled={
          isScanningSensory || sensoryCooldown > 0 || currentSector === undefined
        }
        title={
          sensoryCooldown > 0
            ? `Sensory cooldown (${Math.ceil(sensoryCooldown)}s)`
            : `Scan for hidden players (${(stealthStatus?.sensoryDetectChance ?? 5).toFixed(0)}% chance)`
        }
        aria-busy={isScanningSensory}
        aria-label="Scan sector"
        className={asMenu ? mapToolClassName : mapIconToolClassName}
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
          )
            return;
          if (sensoryCooldown <= 0 && currentSector !== undefined) {
            sensoryInFlightRef.current = true;
            scanSensory({ sector: currentSector });
          }
        }}
      >
        {isScanningSensory ? (
          <Loader2 className="size-6 shrink-0 animate-spin" aria-hidden />
        ) : (
          <Radar className="size-6 shrink-0" aria-hidden />
        )}
        <span className={asMenu ? "min-w-0" : "sr-only"}>
          <span className="block text-sm font-semibold">Sensory scan</span>
          <span className="text-muted-foreground block text-xs" role="status">
            {isScanningSensory
              ? "Scanning…"
              : sensoryCooldown > 0
                ? `Ready in ${Math.ceil(sensoryCooldown)}s`
                : `Find hidden players · ${(stealthStatus?.sensoryDetectChance ?? 5).toFixed(0)}% chance`}
          </span>
        </span>
      </button>
    </>
  );
};

// Alias the procedure so its action name is not interpreted as a React hook.
const activateSensory = api.stealth.useSensory;
