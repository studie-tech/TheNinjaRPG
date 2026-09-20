"use client";

import { Settings } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { OccupationType } from "@/drizzle/constants";
import {
  IMG_OCCUPATION_CRAFTING,
  IMG_OCCUPATION_GATHERING,
  IMG_OCCUPATION_HUNTER,
  OCCUPATION_CHANGE_COOLDOWN_DAYS,
} from "@/drizzle/constants";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import OccupationCrafting from "@/layout/OccupationCrafting";
import OccupationGathering from "@/layout/OccupationGathering";
import OccupationHunter from "@/layout/OccupationHunter";
import { showMutationToast } from "@/libs/toast";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";

/**
 * Occupation data
 */
const OCCUPATION_DATA = [
  {
    type: "GATHERING" as const,
    name: "Gathering",
    image: IMG_OCCUPATION_GATHERING,
    description: "Gather resources from the world",
  },
  {
    type: "HUNTER" as const,
    name: "Hunter",
    image: IMG_OCCUPATION_HUNTER,
    description: "Hunt creatures and enemies",
  },
  {
    type: "CRAFTING" as const,
    name: "Crafting",
    image: IMG_OCCUPATION_CRAFTING,
    description: "Craft items and equipment",
  },
];

export default function Occupations() {
  // Utils
  const utils = api.useUtils();

  // State
  const { data: userData } = useRequiredUserData();
  const [selectedOccupation, setSelectedOccupation] = useState<OccupationType | null>(
    null,
  );
  const [changeDialogOpen, setChangeDialogOpen] = useState(false);

  // Logic for when the user can change occupation
  const occupationInfo = OCCUPATION_DATA.find(
    (occ) => occ.type === userData?.occupation,
  );
  let canChange = true;
  let daysRemaining = 0;
  if (userData?.occupation && userData?.occupationSignupAt) {
    const daysSinceSignup = Math.floor(
      (Date.now() - userData.occupationSignupAt.getTime()) / (1000 * 60 * 60 * 24),
    );
    canChange = daysSinceSignup >= OCCUPATION_CHANGE_COOLDOWN_DAYS;
    daysRemaining = canChange ? 0 : OCCUPATION_CHANGE_COOLDOWN_DAYS - daysSinceSignup;
  }
  const changeStatusData = { canChange, daysRemaining };

  // Mutation for selecting occupation
  const { mutate: selectOccupation, isPending } =
    api.occupation.selectOccupation.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data?.success) {
          setSelectedOccupation(null);
          setChangeDialogOpen(false);
          await utils.profile.getUser.invalidate();
        }
      },
    });

  if (!userData) {
    return <Loader explanation="Loading jobs data..." />;
  }

  /**
   * Handle occupation selection
   * @param occupation - The occupation to select
   */
  const handleOccupationSelect = (occupation: OccupationType) => {
    if (selectedOccupation === occupation) {
      // Confirm selection
      selectOccupation({ occupation });
    } else {
      // First click - select for confirmation
      setSelectedOccupation(occupation);
    }
  };

  const topRightContent =
    userData?.occupation &&
    (changeStatusData?.canChange || canChangeContent(userData?.role || "USER")) ? (
      <Dialog open={changeDialogOpen} onOpenChange={setChangeDialogOpen}>
        <DialogTrigger asChild>
          <Button>
            <Settings className="mr-2 h-5 w-5" />
            Change Job
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Change Occupation</DialogTitle>
          </DialogHeader>
          <OccupationSelector
            selectedOccupation={selectedOccupation}
            onOccupationSelect={handleOccupationSelect}
            currentOccupation={userData.occupation}
            isPending={isPending}
            isChanging
          />
        </DialogContent>
      </Dialog>
    ) : null;

  return (
    <>
      <ContentBox
        title="Occupation"
        subtitle="Work for your village"
        defaultBackHref="/profile"
        topRightContent={topRightContent}
      >
        {userData?.occupation ? (
          <div>
            {occupationInfo && (
              <div className="flex flex-col gap-0.5 sm:gap-1">
                <p className="mt-0.5 text-muted-foreground text-sm leading-relaxed sm:text-base">
                  {occupationInfo.description}
                </p>
              </div>
            )}
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              {userData.occupationSignupAt && (
                <div className="flex items-center gap-1.5 text-muted-foreground text-xs sm:text-sm">
                  <span className="font-medium">Started:</span>
                  <span className="font-mono">
                    {userData.occupationSignupAt.toLocaleDateString()}
                  </span>
                </div>
              )}
              {changeStatusData &&
                !changeStatusData.canChange &&
                !canChangeContent(userData?.role || "USER") && (
                  <div className="flex items-center gap-1.5 font-medium text-orange-600 text-xs sm:text-sm">
                    <span>You can change occupations in</span>
                    {userData.occupationSignupAt && (
                      <span className="rounded bg-popover px-2 py-0.5 font-mono">
                        <Countdown
                          targetDate={
                            new Date(
                              userData.occupationSignupAt.getTime() +
                                OCCUPATION_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000,
                            )
                          }
                        />
                      </span>
                    )}
                  </div>
                )}
            </div>
          </div>
        ) : (
          <OccupationSelector
            selectedOccupation={selectedOccupation}
            onOccupationSelect={handleOccupationSelect}
            isPending={isPending}
          />
        )}
      </ContentBox>
      {userData && renderOccupationComponent(userData)}
    </>
  );
}

// Reusable component for occupation selection
interface OccupationSelectorProps {
  selectedOccupation: OccupationType | null;
  onOccupationSelect: (occupation: OccupationType) => void;
  currentOccupation?: OccupationType;
  isPending: boolean;
  isChanging?: boolean;
}

/**
 * Occupation selector component
 * @param param0
 * @returns
 */
const OccupationSelector: React.FC<OccupationSelectorProps> = ({
  selectedOccupation,
  onOccupationSelect,
  currentOccupation,
  isPending,
  isChanging = false,
}) => {
  return (
    <div className="space-y-6">
      {isChanging && (
        <p className="text-center text-muted-foreground">
          Choose your new occupation. You can change again in{" "}
          {OCCUPATION_CHANGE_COOLDOWN_DAYS} days.
        </p>
      )}

      {!isChanging && (
        <p className="text-center text-muted-foreground">
          Choose an occupation to begin your journey. You can change your occupation
          every 3 days.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {OCCUPATION_DATA.map((occupation) => {
          const isCurrentOccupation = currentOccupation === occupation.type;
          const isDisabled = isChanging && isCurrentOccupation;

          return (
            <button
              type="button"
              key={occupation.type}
              disabled={isDisabled}
              className={`cursor-pointer rounded-lg border p-6 text-center transition-all hover:shadow-lg ${selectedOccupation === occupation.type ? "border-primary bg-primary/5" : "border-border bg-card"} ${isDisabled ? "cursor-not-allowed opacity-50" : ""}`}
              onClick={() => {
                if (!isDisabled) {
                  onOccupationSelect(occupation.type);
                }
              }}
            >
              <div className="mb-4 flex justify-center">
                <Image
                  src={occupation.image}
                  alt={occupation.name}
                  width={128}
                  height={128}
                  className="rounded-lg"
                />
              </div>
              <h3 className="mb-2 font-semibold text-xl">{occupation.name}</h3>
              <p className="mb-4 text-muted-foreground text-sm">
                {occupation.description}
              </p>
              {isCurrentOccupation && isChanging ? (
                <span className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm opacity-50">
                  Current Occupation
                </span>
              ) : selectedOccupation === occupation.type ? (
                <span className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground text-sm">
                  {isPending
                    ? isChanging
                      ? "Changing..."
                      : "Selecting..."
                    : isChanging
                      ? "Confirm Change"
                      : "Confirm Selection"}
                </span>
              ) : (
                <span className="inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-4 py-2 font-medium text-sm hover:bg-accent hover:text-accent-foreground">
                  Select
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Render the occupation component
 * @returns The occupation component
 */
const renderOccupationComponent = (userData: {
  occupation?: OccupationType | null;
}) => {
  if (!userData?.occupation) return null;

  switch (userData.occupation) {
    case "GATHERING":
      return <OccupationGathering />;
    case "HUNTER":
      return <OccupationHunter />;
    case "CRAFTING":
      return <OccupationCrafting />;
    default:
      return null;
  }
};
