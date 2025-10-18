"use client";

import React, { useState } from "react";
import Image from "next/image";
import Modal2 from "@/layout/Modal2";
import Loader from "@/layout/Loader";
import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendGTMEvent } from "@next/third-parties/google";
import { api, useGlobalOnMutateProtect } from "@/app/_trpc/client";
import { calcHP, calcSP, calcCP } from "@/libs/profile";
import { calcLevelRequirements } from "@/libs/profile";
import { useRequiredUserData } from "@/utils/UserContext";
import { showMutationToast } from "@/libs/toast";
import { triggerConfetti } from "@/libs/toast";
import { IMG_PROFILE_LEVELUPGUY } from "@/drizzle/constants";
import { useTutorialStep } from "@/hooks/tutorial";

interface LevelUpBtnProps {
  id?: string;
}

const LevelUpBtn: React.FC<LevelUpBtnProps> = ({ id }) => {
  // State
  const onMutateCheck = useGlobalOnMutateProtect();
  const { data: userData } = useRequiredUserData();
  const [showModal, setShowModal] = useState<boolean>(false);
  const [isLevelling, setIsLevelling] = useState<boolean>(false);

  // tRPC utility
  const utils = api.useUtils();

  // Tutorial hook
  const { currentStep, handleNextStepAsync } = useTutorialStep();

  // Fetch avatar query
  const { mutate: levelUp } = api.profile.levelUp.useMutation({
    onMutate: () => {
      onMutateCheck();
      setIsLevelling(true);
    },
    onSuccess: async (data) => {
      showMutationToast(data);
      void triggerConfetti();
      if (currentStep?.title === "Level Up!") {
        await handleNextStepAsync();
      }
      if (data.success && userData) {
        await utils.profile.getUser.invalidate();
        sendGTMEvent({
          event: "level_up",
          level: userData.level + 1,
          character: userData.userId,
        });
      }
    },
    onSettled: () => {
      document.body.style.cursor = "default";
      setIsLevelling(false);
    },
  });

  // Don't show anyth
  if (!userData) return null;

  // Derived
  const expRequired = Math.max(calcLevelRequirements(userData.level));

  // If no href, show loader, otherwise show avatar
  return (
    <>
      {userData.experience >= expRequired && userData.level < 100 && (
        <div className="mt-2">
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
            <GraduationCap className="h-6 w-6 mr-2" />
            Level up!
          </Button>
        </div>
      )}
      {showModal && (
        <Modal2
          id="tutorial-level-up-modal"
          title={`Level up to Lvl ${userData.level + 1}!`}
          isOpen={showModal}
          setIsOpen={setShowModal}
          proceed_label="Awesome!"
          isValid={false}
          onAccept={() => {
            levelUp();
            setShowModal(false);
          }}
        >
          <div className="basis-1/2 absolute top-0 right-0 opacity-20">
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
        </Modal2>
      )}
    </>
  );
};

export default LevelUpBtn;
