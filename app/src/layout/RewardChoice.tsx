"use client";

import { atom, useAtom, useSetAtom } from "jotai";
import {
  Check,
  Coins,
  Gift,
  type LucideIcon,
  Shield,
  Sparkles,
  Star,
  Swords,
  TrendingUp,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Image from "@/layout/Image";
import Modal from "@/layout/Modal";
import {
  REWARD_CHOICE_CATEGORY_LABELS,
  requiredRewardPicks,
  toggleRewardPick,
} from "@/libs/rewardChoice";
import { cn } from "@/libs/shadui";
import { showRewardToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { useUserData } from "@/utils/UserContext";
import type { RewardChoiceDisplay } from "@/validators/rewards";

/**
 * Global modal where the player picks the rewards of a completed "choose" quest. It opens on
 * its own whenever an offer is waiting that the player has not dismissed in this session.
 */
export const RewardChoiceModal: React.FC = () => {
  const { data: userData, prepareUserUpdate, updateUser } = useUserData();
  const utils = api.useUtils();
  const [forceOpen, setForceOpen] = useAtom(rewardChoiceOpenAtom);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [selection, setSelection] = useState<{ choiceId: string; cardIds: string[] }>({
    choiceId: "",
    cardIds: [],
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: choices } = api.quests.getPendingRewardChoices.useQuery(undefined, {
    enabled: !!userData,
    staleTime: 5 * 60 * 1000,
  });

  const { mutate: claim, isPending: isClaiming } =
    api.quests.claimRewardChoice.useMutation({
      onMutate: () => ({ userRevision: prepareUserUpdate() }),
      onSuccess: async (data, _variables, context) => {
        if (!data.success) {
          setErrorMessage(data.message);
          await utils.quests.getPendingRewardChoices.invalidate();
          return;
        }
        setErrorMessage(null);
        if (data.rewards)
          showRewardToast(
            [],
            data.rewards,
            data.message,
            false,
            undefined,
            data.badges,
          );
        await Promise.all([
          utils.quests.getPendingRewardChoices.invalidate(),
          updateUser(data.userPatch, {
            revision: context?.userRevision,
            delta: data.userDelta,
          }),
        ]);
      },
      onError: (error) => setErrorMessage(error.message),
    });

  const current = choices?.find(
    (choice) => forceOpen || !dismissedIds.includes(choice.choiceId),
  );
  const selectedIds =
    current && selection.choiceId === current.choiceId ? selection.cardIds : [];
  const unavailableIds = new Set(
    current?.cards.filter((card) => card.unavailableReason).map((card) => card.id),
  );
  const required = current ? requiredRewardPicks(current, unavailableIds) : 0;
  const remaining = (choices?.length ?? 0) - 1;

  const toggleCard = (cardId: string) => {
    if (!current || isClaiming || unavailableIds.has(cardId)) return;
    setErrorMessage(null);
    setSelection({
      choiceId: current.choiceId,
      cardIds: toggleRewardPick(selectedIds, cardId, required, current.cards),
    });
  };

  const dismiss = () => {
    if (current) setDismissedIds((ids) => [...ids, current.choiceId]);
    setForceOpen(false);
    setErrorMessage(null);
  };

  if (!current) return null;

  return (
    <Modal
      id="reward-choice"
      title="Choose Your Reward"
      className="sm:max-w-4xl"
      isOpen={true}
      setIsOpen={(open) => {
        const isOpen = typeof open === "function" ? open(true) : open;
        if (!isOpen) dismiss();
      }}
      proceed_label={
        required === 0 ? "Clear Offer" : `Claim Reward${required === 1 ? "" : "s"}`
      }
      proceed_loading_label="Claiming..."
      isLoading={isClaiming}
      proceedDisabled={selectedIds.length !== required}
      keepOpenOnAccept
      dismissOnInteractOutside={false}
      footerClassName="flex-row gap-2 sm:space-x-0"
      confirmClassName="bg-red-700 text-white hover:bg-red-800"
      onAccept={() =>
        claim({
          questId: current.questId,
          choiceId: current.choiceId,
          cardIds: selectedIds,
        })
      }
    >
      <div className="space-y-3">
        <div className="text-center">
          <p className="font-semibold">{current.questName}</p>
          <p className="text-muted-foreground text-sm">
            {required === 0
              ? "You already have every reward offered here"
              : `Select ${required} reward${required === 1 ? "" : "s"} to claim`}
          </p>
        </div>
        <fieldset className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
          <legend className="sr-only">Rewards to choose from</legend>
          {current.cards.map((card) => {
            const isSelected = selectedIds.includes(card.id);
            // Blocked when clicking would not change the selection (e.g. a full multi-pick).
            const isBlocked =
              !!card.unavailableReason ||
              (!isSelected &&
                toggleRewardPick(selectedIds, card.id, required, current.cards) ===
                  selectedIds);
            return (
              <RewardChoiceCard
                key={card.id}
                card={card}
                isSelected={isSelected}
                isBlocked={isBlocked}
                onToggle={() => toggleCard(card.id)}
              />
            );
          })}
        </fieldset>
        <p
          className="text-center font-medium text-sm"
          aria-live="polite"
          id="reward-choice-count"
        >
          {selectedIds.length} / {required} selected
          {remaining > 0 && (
            <span className="text-muted-foreground">
              {" "}
              · {remaining} more reward choice{remaining === 1 ? "" : "s"} waiting
            </span>
          )}
        </p>
        {errorMessage && (
          <p role="alert" className="text-center text-red-500 text-sm">
            {errorMessage}
          </p>
        )}
      </div>
    </Modal>
  );
};

/** Logbook notice for offers still waiting, with a button that reopens the modal. */
export const PendingRewardChoices: React.FC<{ className?: string }> = ({
  className,
}) => {
  const { data: userData } = useUserData();
  const openRewardChoice = useOpenRewardChoice();
  const { data: choices } = api.quests.getPendingRewardChoices.useQuery(undefined, {
    enabled: !!userData,
    staleTime: 5 * 60 * 1000,
  });
  if (!choices || choices.length === 0) return null;
  return (
    <div
      className={cn(
        "m-2 flex flex-row items-center gap-3 rounded-md border border-amber-500/60 bg-amber-500/10 p-3",
        className,
      )}
    >
      <Gift className="h-6 w-6 shrink-0 text-amber-500" />
      <div className="grow text-sm">
        <p className="font-semibold">Rewards waiting</p>
        <p className="text-muted-foreground">
          {choices.map((choice) => choice.questName).join(", ")}
        </p>
      </div>
      <Button onClick={() => void openRewardChoice()}>Choose</Button>
    </div>
  );
};

const RewardChoiceCard: React.FC<{
  card: RewardChoiceDisplay["cards"][number];
  isSelected: boolean;
  isBlocked: boolean;
  onToggle: () => void;
}> = ({ card, isSelected, isBlocked, onToggle }) => {
  const Icon = getAmountIcon(card.field);
  const isAmountCard = !card.contentId;
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      aria-disabled={isBlocked}
      onClick={onToggle}
      className={cn(
        "relative flex flex-col items-center gap-1 rounded-lg border-2 bg-card p-2 text-center transition sm:gap-2 sm:p-3",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isSelected
          ? "border-red-600 shadow-[0_0_12px_rgba(220,38,38,0.6)]"
          : "border-border hover:border-red-400",
        isBlocked && "opacity-50",
      )}
    >
      {card.rarity && (
        <Badge variant="secondary" className="uppercase tracking-wide">
          {card.rarity}
        </Badge>
      )}
      <div className="flex h-14 w-14 items-center justify-center sm:h-24 sm:w-24">
        {card.image ? (
          <Image
            src={card.image}
            alt={card.name}
            width={96}
            height={96}
            className="h-14 w-14 rounded-md object-contain sm:h-24 sm:w-24"
          />
        ) : (
          <Icon className="h-10 w-10 text-amber-500 sm:h-16 sm:w-16" aria-hidden />
        )}
      </div>
      <div className="font-bold text-sm leading-tight sm:text-lg">
        {isAmountCard ? `${card.amount.toLocaleString()} ${card.name}` : card.name}
      </div>
      <div className="text-orange-500 text-xs sm:text-sm">
        {REWARD_CHOICE_CATEGORY_LABELS[card.field]}
        {!isAmountCard && card.amount > 1 && ` · x${card.amount}`}
      </div>
      {card.description && (
        <div className="line-clamp-2 text-muted-foreground text-xs sm:line-clamp-3">
          {parseHtml(card.description)}
        </div>
      )}
      <div
        className={cn(
          "mt-auto flex items-center gap-2 text-xs sm:text-sm",
          isSelected ? "font-semibold text-red-600" : "text-muted-foreground",
        )}
      >
        <span
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-full border",
            isSelected ? "border-red-600 bg-red-600 text-white" : "border-current",
          )}
        >
          {isSelected && <Check className="h-3 w-3" />}
        </span>
        {card.unavailableReason ? (
          card.unavailableReason
        ) : isSelected ? (
          "Selected"
        ) : (
          <>
            Select<span className="hidden sm:inline"> this reward</span>
          </>
        )}
      </div>
    </button>
  );
};

const getAmountIcon = (field: string): LucideIcon => {
  if (field === "reward_war_damage") return Swords;
  if (field === "reward_war_healing") return Shield;
  if (field === "reward_skillpoints") return Star;
  if (field.endsWith("experience") || field === "reward_exp") return TrendingUp;
  if (field === "reward_reputation" || field === "reward_prestige") return Sparkles;
  return Coins;
};

/**
 * Requests the reward-choice modal to open, also for offers the player dismissed earlier in
 * this session (e.g. from the logbook button, or after a completion was refused because an
 * offer is still waiting).
 */
export const rewardChoiceOpenAtom = atom<boolean>(false);

/** Opens the reward-choice modal and refreshes the waiting offers. */
export const useOpenRewardChoice = () => {
  const utils = api.useUtils();
  const setOpen = useSetAtom(rewardChoiceOpenAtom);
  return async () => {
    await utils.quests.getPendingRewardChoices.invalidate();
    setOpen(true);
  };
};
