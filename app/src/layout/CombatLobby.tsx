import { useSetAtom } from "jotai";
import { Check, HelpCircle, Loader2 } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { IMG_INITIATIVE_D20, PvpBattleTypes } from "@/drizzle/constants";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import ItemLoadoutSelector from "@/layout/ItemLoadoutSelector";
import JutsuLoadoutSelector from "@/layout/JutsuLoadoutSelector";
import Link from "@/layout/Link";
import type { BattleState, ReturnedBattle } from "@/libs/combat/types";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData, userBattleAtom } from "@/utils/UserContext";

interface CombatLobbyProps {
  battleRef: React.RefObject<ReturnedBattle | null | undefined>;
  isInLobby: boolean;
  setBattleState: React.Dispatch<React.SetStateAction<BattleState | undefined>>;
}

/**
 * The PvP lobby before a battle starts: initiative, readiness and loadout choices.
 * Rendered with the battle so its requests outlive the countdown.
 */
export const CombatLobby: React.FC<CombatLobbyProps> = ({
  battleRef,
  isInLobby,
  setBattleState,
}) => {
  const utils = api.useUtils();
  const [readySettledBattleId, setReadySettledBattleId] = useState<string | null>(null);
  const [pendingLoadoutSelection, setPendingLoadoutSelection] = useState<{
    battleId: string;
    kind: "item" | "jutsu";
    loadoutId: string;
    displayName: string;
  } | null>(null);

  const readyInFlightBattleIdRef = useRef<string | null>(null);
  const loadoutInFlightRef = useRef<{
    battleId: string;
    kind: "item" | "jutsu";
    loadoutId: string;
  } | null>(null);
  const battleId = battleRef.current?.id;
  const setBattleAtom = useSetAtom(userBattleAtom);
  const { data: userData, timeDiff } = useRequiredUserData();
  const suid = userData?.userId;

  // Session battle user state (the human's own account — used for lobby/ready
  // UI and loadout selection, NOT the actor it pilots).
  const battleSessionUser = battleRef.current?.usersState.find(
    (u) => u.userId === userData?.userId,
  );
  // Once this participant's readiness has been proven by the mutation response,
  // do not let an older query snapshot expose the action again. Battle IDs are
  // immutable, so a genuinely new lobby resets this local settlement naturally.
  const hasSettledReady =
    !!battleId &&
    (battleSessionUser?.iAmHere === true || readySettledBattleId === battleId);
  const activePendingLoadout =
    pendingLoadoutSelection?.battleId === battleId ? pendingLoadoutSelection : null;

  // I am here call
  const { mutate: iAmHere, isPending: isMarkingReady } = api.combat.iAmHere.useMutation(
    {
      onSuccess: (data, variables) => {
        const readinessWasProven =
          "battle" in data &&
          data.success &&
          data.battle?.usersState.some((user) => user.userId === suid && user.iAmHere);

        if (readinessWasProven && data.battle) {
          setReadySettledBattleId(variables.battleId);

          // Do not replace a newer battle with a response from a lobby the user
          // has already left. The settlement is keyed to the old battle and is
          // therefore harmless when the new battle renders.
          if (battleRef.current?.id === variables.battleId) {
            battleRef.current = data.battle;
            setBattleAtom(data.battle);
            setBattleState({ battle: data.battle, result: null, isPending: false });
            void utils.combat.getBattle.invalidate();
          }
        } else {
          showMutationToast({
            success: false,
            message:
              data.message ||
              "The combat lobby has expired. Refresh to see the current battle.",
          });
        }
      },
      onSettled: (_data, _error, variables) => {
        if (readyInFlightBattleIdRef.current === variables.battleId) {
          readyInFlightBattleIdRef.current = null;
        }
      },
    },
  );

  const handleMarkReady = () => {
    const currentBattleId = battleRef.current?.id;
    const sessionUser = battleRef.current?.usersState.find(
      (user) => user.userId === suid,
    );
    if (
      !currentBattleId ||
      !suid ||
      isMarkingReady ||
      loadoutInFlightRef.current?.battleId === currentBattleId ||
      readyInFlightBattleIdRef.current === currentBattleId ||
      sessionUser?.iAmHere ||
      readySettledBattleId === currentBattleId
    ) {
      return;
    }

    readyInFlightBattleIdRef.current = currentBattleId;
    iAmHere({ battleId: currentBattleId });
  };

  // Mutation for selecting loadouts
  const { mutate: selectLoadout } = api.combat.updateCombatLoadout.useMutation({
    onSuccess: (data, variables) => {
      if (
        "battle" in data &&
        data.success &&
        data.battle &&
        data.battle.id === variables.battleId
      ) {
        // The response belongs to an immutable lobby ID. Never allow a slow
        // response from a lobby the player has left to replace the new battle.
        if (battleRef.current?.id === variables.battleId) {
          battleRef.current = data.battle;
          setBattleAtom(data.battle);
          setBattleState({ battle: data.battle, result: null, isPending: false });
          if (data.message) {
            showMutationToast({
              success: true,
              title: "Loadout updated",
              message: data.message,
            });
          }
          void utils.combat.getBattle.invalidate();
        }
      } else {
        showMutationToast({
          success: false,
          message:
            data.message ||
            "The combat lobby changed before this loadout could be saved.",
        });
      }
    },
    onSettled: (_data, _error, variables) => {
      const kind = variables.itemLoadoutId ? "item" : "jutsu";
      const loadoutId = variables.itemLoadoutId ?? variables.jutsuLoadoutId;
      const currentRequest = loadoutInFlightRef.current;
      if (
        loadoutId &&
        currentRequest?.battleId === variables.battleId &&
        currentRequest.kind === kind &&
        currentRequest.loadoutId === loadoutId
      ) {
        loadoutInFlightRef.current = null;
        setPendingLoadoutSelection((pending) =>
          pending?.battleId === variables.battleId &&
          pending.kind === kind &&
          pending.loadoutId === loadoutId
            ? null
            : pending,
        );
      }
    },
  });

  const handleSelectLoadout = (
    kind: "item" | "jutsu",
    loadoutId: string,
    displayName: string,
  ) => {
    const currentBattle = battleRef.current;
    const currentUser = currentBattle?.usersState.find((user) => user.userId === suid);
    if (
      !currentBattle ||
      !currentUser ||
      currentUser.iAmHere ||
      readySettledBattleId === currentBattle.id ||
      readyInFlightBattleIdRef.current === currentBattle.id ||
      loadoutInFlightRef.current?.battleId === currentBattle.id
    ) {
      return;
    }

    const selectedId =
      kind === "item" ? currentUser.itemLoadout : currentUser.jutsuLoadout;
    if (selectedId === loadoutId) return;

    const pending = { battleId: currentBattle.id, kind, loadoutId, displayName };
    loadoutInFlightRef.current = pending;
    setPendingLoadoutSelection(pending);
    selectLoadout({
      battleId: currentBattle.id,
      ...(kind === "item"
        ? { itemLoadoutId: loadoutId }
        : { jutsuLoadoutId: loadoutId }),
    });
  };

  const initiveWinner = battleRef.current?.usersState.find(
    (u) => u.userId === battleRef.current?.activeUserId,
  );

  return (
    <>
      {isInLobby &&
        battleRef.current &&
        PvpBattleTypes.includes(battleRef.current.battleType) && (
          <div className="absolute top-0 right-0 bottom-0 left-0 z-20 m-auto overflow-y-auto bg-black/90">
            <div className="flex h-full flex-col items-center justify-center text-white">
              <p className="text-3xl">Waiting for opponent</p>
              <p className="text-xl">
                Time Left:{" "}
                <Countdown
                  targetDate={battleRef.current.createdAt}
                  timeDiff={timeDiff}
                />
              </p>
              <p className="mb-2 flex flex-row text-lg">
                Initiative Winner: {initiveWinner?.username}{" "}
                <Link href="/manual/combat">
                  <HelpCircle className="h6 ml-2 w-6 hover:text-orange-500" />
                </Link>
              </p>
              <div className="flex flex-row gap-4">
                {battleRef.current.usersState
                  .filter((u) => u.isOriginal && !u.isAi)
                  .map((u) => {
                    return (
                      <div
                        key={`${u.userId}-initiative-${u.initiative}`}
                        className="relative flex flex-col items-center font-bold"
                      >
                        <Image
                          alt={`roll-${u.userId}`}
                          src={IMG_INITIATIVE_D20}
                          height={60}
                          width={60}
                        ></Image>
                        <p className="absolute top-7 text-md">
                          {Math.floor(u.initiative)}
                        </p>
                        <p>
                          {u.username}{" "}
                          {u.iAmHere ||
                          (u.userId === suid && readySettledBattleId === battleId)
                            ? "(✓)"
                            : ""}
                        </p>
                      </div>
                    );
                  })}
              </div>
              <fieldset
                className="mt-3 flex flex-row items-end gap-3"
                disabled={isMarkingReady || hasSettledReady || !!activePendingLoadout}
                aria-busy={isMarkingReady || !!activePendingLoadout}
              >
                {(battleRef.current.battleType === "COMBAT" ||
                  battleRef.current.battleType === "SPARRING") && (
                  <>
                    <ItemLoadoutSelector
                      variant="dropdown"
                      label="Item Loadout"
                      onSelectOverride={(loadoutId, displayName) =>
                        handleSelectLoadout("item", loadoutId, displayName)
                      }
                      selectedOverrideId={battleSessionUser?.itemLoadout}
                    />
                    <JutsuLoadoutSelector
                      variant="dropdown"
                      label="Jutsu Loadout"
                      onSelectOverride={(loadoutId, displayName) =>
                        handleSelectLoadout("jutsu", loadoutId, displayName)
                      }
                      selectedOverrideId={battleSessionUser?.jutsuLoadout}
                    />
                  </>
                )}
                <Button
                  variant="secondary"
                  className="shrink-0"
                  disabled={isMarkingReady || hasSettledReady || !!activePendingLoadout}
                  aria-busy={isMarkingReady || !!activePendingLoadout}
                  onClick={handleMarkReady}
                >
                  {isMarkingReady ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                      Confirming
                    </>
                  ) : hasSettledReady ? (
                    <>
                      <Check className="mr-2 h-4 w-4" aria-hidden />
                      Ready
                    </>
                  ) : (
                    "I'm Ready"
                  )}
                </Button>
              </fieldset>
              {activePendingLoadout && (
                <p
                  className="mt-2 flex items-center text-sm text-white/80"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Saving
                </p>
              )}
            </div>
          </div>
        )}
    </>
  );
};
