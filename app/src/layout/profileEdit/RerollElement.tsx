"use client";

import type React from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { COST_REROLL_ELEMENT } from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { getBloodlineElements } from "@/libs/userElements";
import { capitalizeFirstLetter } from "@/utils/string";
import { useRequiredUserData } from "@/utils/UserContext";

interface ElementRerollButtonProps {
  elementType: "primary" | "secondary";
  canAfford: boolean;
  canChange: boolean;
  onReroll: (elementType: "primary" | "secondary") => void;
}

const ElementRerollButton: React.FC<ElementRerollButtonProps> = ({
  elementType,
  canAfford,
  canChange,
  onReroll,
}) => (
  <Confirm
    title={`Confirm ${capitalizeFirstLetter(elementType)} Element Re-Roll`}
    button={
      <Button
        id={`reroll-${elementType}`}
        type="submit"
        className="w-full"
        disabled={!canAfford || !canChange}
      >
        Re-Roll {capitalizeFirstLetter(elementType)} Element
      </Button>
    }
    onAccept={(e) => {
      e.preventDefault();
      onReroll(elementType);
    }}
  >
    Rerolling your {elementType} element costs {COST_REROLL_ELEMENT} reputation points.
    Are you sure you want to re-roll your {elementType} element?
  </Confirm>
);

/** Paid innate rerolls are unavailable while a bloodline overrides the pair. */
export const RerollElement: React.FC = () => {
  // State
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();

  // Training an overridden innate element does not make its stored slot rerollable.
  const hasBloodlineElements = getBloodlineElements(userData).length > 0;

  // Mutations
  const { mutate: roll, isPending: isRolling } =
    api.blackmarket.rerollElement.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.success) {
          await updateUser(data, { revision, delta: data.userDelta });
        }
      },
    });

  // Loaders
  if (isRolling) return <Loader explanation="Rerolling" />;

  // Guards
  const canAfford = userData && userData.reputationPoints >= COST_REROLL_ELEMENT;
  const canChangeFirst = !!userData?.primaryElement && !hasBloodlineElements;
  const canChangeSecond = !!userData?.secondaryElement && !hasBloodlineElements;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <ElementRerollButton
          elementType="primary"
          canAfford={canAfford ?? false}
          canChange={canChangeFirst}
          onReroll={(elementType) => roll({ elementType })}
        />
        <ElementRerollButton
          elementType="secondary"
          canAfford={canAfford ?? false}
          canChange={canChangeSecond}
          onReroll={(elementType) => roll({ elementType })}
        />
      </div>
    </div>
  );
};
