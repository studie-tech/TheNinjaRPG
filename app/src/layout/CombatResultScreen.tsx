import { useSetAtom } from "jotai";
import type React from "react";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { CombatRewards } from "@/layout/CombatRewards";
import { HuntingBoard } from "@/layout/HuntingBoard";
import Link from "@/layout/Link";
import { isPvpEnergyRewardBattle, sendsToHospital } from "@/libs/combat/settlement";
import type { BattleState, CombatResult, ReturnedBattle } from "@/libs/combat/types";
import { getIsolatedPyramid } from "@/libs/questRun";
import { showMutationToast } from "@/libs/toast";
import { getTutorialBattleReturnPage } from "@/libs/tutorial";
import { TUTORIAL_STEPS, type TutorialStepConfig } from "@/libs/tutorialSteps";
import { useRequiredUserData, userBattleAtom } from "@/utils/UserContext";

interface CombatResultScreenProps {
  result: CombatResult;
  battleRef: React.RefObject<ReturnedBattle | null | undefined>;
  userId: string;
  currentStep: TutorialStepConfig | undefined;
  setBattleState: React.Dispatch<React.SetStateAction<BattleState | undefined>>;
  arenaActions?: React.ReactNode;
}

/** The outcome of a finished battle, its rewards and the ways to leave it. */
export const CombatResultScreen: React.FC<CombatResultScreenProps> = (props) => {
  const { result, battleRef, currentStep, setBattleState } = props;
  const router = useRouter();
  const utils = api.useUtils();
  const [isReturningFromTutorial, setIsReturningFromTutorial] = useState(false);
  const tutorialReturnLockRef = useRef(false);
  const battleType = battleRef.current?.battleType;
  const setBattleAtom = useSetAtom(userBattleAtom);
  const { data: userData } = useRequiredUserData();

  const showShrineAgain = result?.outcome === "Won" && battleType === "SHRINE_WAR";
  const showTravelBtn = battleType === "QUEST" && !getIsolatedPyramid(userData);
  const toHospital =
    !!battleRef.current &&
    !!result &&
    sendsToHospital(battleRef.current, result.curHealth);

  const handleTutorialBattleReturn = async (
    event: React.MouseEvent<HTMLAnchorElement>,
    destination: string,
  ) => {
    if (!currentStep || !userData?.tutorialOn || getIsolatedPyramid(userData)) return;
    event.preventDefault();
    if (tutorialReturnLockRef.current) return;
    tutorialReturnLockRef.current = true;
    setIsReturningFromTutorial(true);
    try {
      // Navigation must wait for the confirmed profile: a cached BATTLE status
      // otherwise makes the tutorial redirect back to the fight that just ended.
      const profile = await utils.profile.getUser.fetch(undefined, { staleTime: 0 });
      router.push(
        getTutorialBattleReturnPage(
          TUTORIAL_STEPS,
          profile.userData,
          result?.outcome,
          destination,
        ),
      );
    } catch {
      showMutationToast({
        success: false,
        message: "Could not load your updated character. Please try returning again.",
      });
    } finally {
      tutorialReturnLockRef.current = false;
      setIsReturningFromTutorial(false);
    }
  };

  return (
    <div className="relative z-20 bg-black/90">
      <div className="mx-auto max-w-3xl px-3 pb-3 text-center text-white sm:px-5 sm:pb-5">
        <p className="p-5 pb-2 text-3xl">You {result.outcome}</p>
        <div className="space-y-4 bg-background p-3 text-foreground sm:p-4">
          {result.hunting && (
            <HuntingBoard
              victory={result.hunting}
              onStarted={() => setBattleAtom(undefined)}
            />
          )}
          <CombatRewards
            result={result}
            isOutlaw={!!userData?.isOutlaw}
            isQuest={battleType === "QUEST"}
            showPvpEnergy={
              !!battleRef.current &&
              isPvpEnergyRewardBattle(battleRef.current, props.userId)
            }
          />
        </div>
        <div className="grid gap-2 pt-3 sm:grid-cols-2 [&>:only-child]:sm:col-span-2">
          <Link
            href={
              getIsolatedPyramid(userData)
                ? "/combat"
                : toHospital
                  ? "/hospital"
                  : "/profile"
            }
            className="w-full"
            onClick={(event) => {
              void handleTutorialBattleReturn(
                event,
                toHospital ? "/hospital" : "/profile",
              );
            }}
          >
            <Button
              id="return"
              className="w-full"
              disabled={isReturningFromTutorial}
              aria-busy={isReturningFromTutorial}
              onClick={() => {
                if (getIsolatedPyramid(userData)) setBattleState(undefined);
              }}
            >
              {isReturningFromTutorial
                ? "Returning..."
                : getIsolatedPyramid(userData)
                  ? "Continue Pyramid"
                  : currentStep && userData?.tutorialOn
                    ? "Continue tutorial"
                    : `Return to ${toHospital ? "Hospital" : "Profile"}`}
            </Button>
          </Link>
          {showShrineAgain && (
            <Link href="/shrine" className="w-full">
              <Button id="return" className="w-full">
                Back to Shrine
              </Button>
            </Link>
          )}
          {props.arenaActions}
          {battleType === "RANKED_PVP" && (
            <Link href="/battlearena#PVP%20Rank" className="w-full">
              <Button id="toPvpRank" className="w-full">
                Back to PvP Queue
              </Button>
            </Link>
          )}
          {battleRef.current?.extraState.dungeon && (
            <Link href="/dungeon" className="w-full">
              <Button className="w-full">Return to party</Button>
            </Link>
          )}
          {showTravelBtn && (
            <Link
              href="/travel"
              className="w-full"
              onClick={(event) => {
                void handleTutorialBattleReturn(event, "/travel");
              }}
            >
              <Button
                id="toTravel"
                className="w-full"
                disabled={isReturningFromTutorial}
                aria-busy={isReturningFromTutorial}
              >
                {isReturningFromTutorial ? "Returning..." : "To Map"}
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};
