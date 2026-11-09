"use client";

import { sendGTMEvent } from "@next/third-parties/google";
import { GraduationCap } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { IMG_PROFILE_LEVELUPGUY } from "@/drizzle/constants";
import { useTutorialStep } from "@/hooks/tutorial";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { calcCP, calcHP, calcSP, levelUpBlockMessage } from "@/libs/profile";
import { showMutationToast, triggerConfetti } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";

interface LevelUpBtnProps {
  id?: string;
  /** Spacing around the button; it renders nothing while no level is available. */
  className?: string;
}

const LevelUpBtn: React.FC<LevelUpBtnProps> = ({ id, className = "mt-2" }) => {
  // State
  const { data: userData, updateUser, prepareUserUpdate } = useRequiredUserData();
  const [showModal, setShowModal] = useState<boolean>(false);

  // tRPC utility
  const utils = api.useUtils();

  // Tutorial hook
  const { currentStep, completeTutorialAction } = useTutorialStep();

  // Level-up mutation
  const { mutate: levelUp, isPending: isLevelling } = api.profile.levelUp.useMutation({
    onMutate: () => ({ userRevision: prepareUserUpdate() }),
    onSuccess: async (data, _variables, context) => {
      showMutationToast(data);
      if (data.success) void triggerConfetti();
      if (data.success && userData) {
        await Promise.all([
          updateUser(data.userPatch, {
            revision: context?.userRevision,
            achievementProgress: data.achievementProgress,
          }),
          utils.profile.getDashboard.invalidate(),
        ]);
        await completeTutorialAction("levelUp");
        sendGTMEvent({
          event: "level_up",
          level: userData.level + 1,
          character: userData.userId,
        });
      }
    },
    onError: async () => {
      await utils.profile.getUser.invalidate();
    },
  });

  // Derived
  const canLevel = !!userData && !levelUpBlockMessage(userData);

  // A level-up step the player cannot take (not enough experience) moves on
  useEffect(() => {
    if (userData && currentStep?.advanceOn === "levelUp" && !canLevel) {
      void completeTutorialAction("levelUp");
    }
  }, [currentStep?.advanceOn, userData, canLevel, completeTutorialAction]);

  if (!userData) return null;

  // Level-up button and confirmation dialog
  return (
    <>
      {canLevel && (
        <div className={className}>
          <Button
            id={id ?? undefined}
            decoration="gold"
            animation="pulse"
            className="w-full"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowModal(true);
            }}
          >
            <GraduationCap className="mr-2 h-6 w-6" />
            Level up!
          </Button>
        </div>
      )}
      {showModal && (
        <Modal
          id="tutorial-level-up-modal"
          title={`Level up to Lvl ${userData.level + 1}!`}
          isOpen={showModal}
          setIsOpen={setShowModal}
          proceed_label="Awesome!"
          onAccept={() => levelUp()}
        >
          <div className="absolute top-0 right-0 basis-1/2 opacity-20">
            <Image
              alt="Level up graphic"
              src={IMG_PROFILE_LEVELUPGUY}
              width={375}
              height={436}
            />
          </div>
          {isLevelling && <Loader explanation="Leveling up..." />}
          {!isLevelling && (
            <>
              <div className="">
                Congratulations on leveling up! Your dedication and hard work have paid
                off, and you have proven yourself to be a true ninja warrior. Keep up
                the great work and continue to hone your skills.
              </div>
              <p className="pt-2">
                <span className="font-bold">New Health:</span>{" "}
                {calcHP(userData.level + 1)} points
              </p>
              <p className="pt-2">
                <span className="font-bold">New Chakra:</span>{" "}
                {calcCP(userData.level + 1)} points
              </p>
              <p className="pt-2">
                <span className="font-bold">New Stamina:</span>{" "}
                {calcSP(userData.level + 1)} points
              </p>
            </>
          )}
        </Modal>
      )}
    </>
  );
};

export default LevelUpBtn;
