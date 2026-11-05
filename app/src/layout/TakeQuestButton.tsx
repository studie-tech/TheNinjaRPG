"use client";

import { Gamepad2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import Confirm from "@/layout/Confirm";
import { formatQuestEntryCost } from "@/libs/questRun";
import type { QuestContentType } from "@/validators/objectives";

interface TakeQuestButtonProps {
  quest: {
    id: string;
    name: string;
    content: Pick<QuestContentType, "isolated">;
  };
  /** Named items consumed on entry; empty when the quest is free to enter. */
  entryCost: readonly { quantity: number; name: string }[];
  disabled?: boolean;
  onStart: () => void;
}

/** Start a quest, confirming entry items and isolated runs before anything is spent. */
export const TakeQuestButton: React.FC<TakeQuestButtonProps> = ({
  quest,
  entryCost,
  disabled,
  onStart,
}) => {
  const needsConfirmation = entryCost.length > 0 || quest.content.isolated;
  const button = (
    <Button
      id={`tutorial-take-quest-${quest.id}`}
      disabled={disabled}
      onClick={needsConfirmation ? undefined : onStart}
    >
      <Gamepad2 className="mr-1 h-6 w-6" />
      Take Quest
    </Button>
  );
  if (!needsConfirmation) return button;

  return (
    <Confirm
      title={`Start ${quest.name}?`}
      disabled={disabled}
      button={button}
      onAccept={onStart}
    >
      {entryCost.length > 0 && (
        <span className="block">
          Entering costs <strong>{formatQuestEntryCost(entryCost)}</strong>. The items
          are consumed when you enter and are not refunded on abandonment. Proceed?
        </span>
      )}
      {quest.content.isolated &&
        "Outside activities are blocked until this run is completed or abandoned."}
    </Confirm>
  );
};
