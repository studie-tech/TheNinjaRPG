"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Confirm from "@/layout/Confirm";
import Countdown from "@/layout/Countdown";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { QueryError } from "@/layout/QueryError";
import { useOpenRewardChoice } from "@/layout/RewardChoice";
import { actionPrerequisiteUser } from "@/libs/actionReadiness";
import {
  isPetTaskContract,
  PET_TASK_IN_PROGRESS_MESSAGE,
  petTaskDispatchBlockMessage,
  petTaskRequirementsText,
} from "@/libs/pets/tasks";
import { formatQuestEntryCost } from "@/libs/questRun";
import { showMutationToast, showRewardToast } from "@/libs/toast";
import { formatSecondsToTimeDisplay } from "@/utils/time";
import { useRequiredUserData } from "@/utils/UserContext";
import type { UserDeltaResponse } from "@/validators/userCache";

/** Compact task management for the selected companion; the accepted task stays visible after job changes. */
export const PetTasks = ({ petId }: { petId: string }) => {
  const { data: user, timeDiff } = useRequiredUserData();
  const [questId, setQuestId] = useState("");
  const feedback = usePetTaskFeedback();
  const task = api.quests.getPetTask.useQuery({ petId }, { enabled: !!user });
  const occupation = user?.occupation;
  const contracts = api.quests.specificQuests.useQuery(
    {
      level: user?.level ?? 0,
      questType: occupation === "GATHERING" ? "gathering" : "hunting",
    },
    {
      enabled:
        !task.data?.task && (occupation === "HUNTER" || occupation === "GATHERING"),
    },
  );
  const start = api.quests.startPetTask.useMutation(feedback.handlers);
  const collect = api.quests.collectPetTask.useMutation(feedback.handlers);
  const cancel = api.quests.cancelPetTask.useMutation(feedback.handlers);
  const pending = start.isPending || collect.isPending || cancel.isPending;
  const available = contracts.data?.filter(isPetTaskContract) ?? [];
  const selected = available.find((entry) => entry.id === questId) ?? available[0];
  const current = task.data?.task;
  const professionLabel = occupation === "GATHERING" ? "gathering" : "hunting";

  if (!user || task.isPending) return <Loader explanation="Loading companion task" />;
  if (task.error)
    return (
      <QueryError
        message={task.error.message}
        retryLabel="Retry"
        retryVariant="link"
        onRetry={() => void task.refetch()}
      />
    );

  return (
    <div className="space-y-3">
      {feedback.message && (
        <p role="alert" className="text-destructive text-sm">
          {feedback.message}
        </p>
      )}
      {current ? (
        <>
          <div>
            <h3 className="font-semibold">
              {task.data?.petName}: {task.data?.questName}
            </h3>
            <p className="text-muted-foreground text-sm">
              Return:{" "}
              <Countdown
                targetDate={new Date(current.finishesAt)}
                timeDiff={timeDiff}
                onFinish={() => void task.refetch()}
                onEndShow="Ready to return"
              />
              . This companion is unavailable until returned.
            </p>
          </div>
          {task.data?.blockMessage &&
            task.data.blockMessage !== PET_TASK_IN_PROGRESS_MESSAGE && (
              <p className="text-sm">{task.data.blockMessage}</p>
            )}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending || !!task.data?.blockMessage}
              onClick={() => collect.mutate(current)}
            >
              {collect.isPending ? "Collecting..." : "Collect results"}
            </Button>
            <Confirm
              title="Return your companion without rewards?"
              disabled={pending}
              button={
                <Button variant="outline" disabled={pending}>
                  Return without rewards
                </Button>
              }
              onAccept={() => cancel.mutate(current)}
            >
              This ends the task without rewards. Entry items already consumed when
              accepting the contract are not refunded.
            </Confirm>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            Send one companion on an enabled profession contract. The final quest reward
            and usual profession drops are paid on return; objectives and intermediate
            rewards are not simulated.
          </p>
          <p className="text-muted-foreground text-sm">
            {petTaskRequirementsText(user.rank)}
          </p>
          {task.data?.dispatchBlockMessage ? (
            <p className="text-sm font-medium">{task.data.dispatchBlockMessage}</p>
          ) : contracts.isPending ? (
            <Loader explanation="Loading profession contracts" />
          ) : contracts.error ? (
            <QueryError
              message={contracts.error.message}
              retryLabel="Retry"
              retryVariant="link"
              onRetry={() => void contracts.refetch()}
            />
          ) : !selected ? (
            <p className="text-sm">
              This companion is ready, but no {professionLabel} contracts for companions
              are available to you right now.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={selected.id} onValueChange={setQuestId} disabled={pending}>
                <SelectTrigger
                  className="w-full sm:w-80"
                  aria-label="Companion contract"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {available.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name} ·{" "}
                      {formatSecondsToTimeDisplay(entry.petTaskMinutes * 60)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Confirm
                title={`Send your companion on ${selected.name}?`}
                disabled={pending}
                button={
                  <Button disabled={pending}>
                    {start.isPending ? "Sending..." : "Send companion"}
                  </Button>
                }
                onAccept={() => start.mutate({ petId, questId: selected.id })}
              >
                <PetTaskTerms
                  minutes={selected.petTaskMinutes}
                  entryRequirements={selected.entryRequirements}
                />
              </Confirm>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/** Existing profession cards can dispatch an eligible owned companion without leaving the contract. */
export const PetTaskDispatch = ({
  questId,
  questName,
  minutes,
  entryRequirements,
}: {
  questId: string;
  questName: string;
  minutes: number;
  entryRequirements: EntryRequirement[];
}) => {
  const { data: user } = useRequiredUserData();
  const [petId, setPetId] = useState("");
  const feedback = usePetTaskFeedback();
  const collection = api.pets.getCollection.useQuery(undefined, {
    enabled: !!user && !user.petTask,
  });
  const start = api.quests.startPetTask.useMutation(feedback.handlers);
  const eligible = user
    ? (collection.data?.pets.filter(
        (pet) => !petTaskDispatchBlockMessage(actionPrerequisiteUser(user), pet),
      ) ?? [])
    : [];
  const selected =
    eligible.find((pet) => pet.id === petId) ??
    eligible.find((pet) => pet.id === user?.activePetId) ??
    eligible[0];
  const pets = collection.data?.pets ?? [];
  const shownPet = pets.find((pet) => pet.id === user?.activePetId) ?? pets[0];
  const blockReason =
    user && shownPet
      ? petTaskDispatchBlockMessage(actionPrerequisiteUser(user), shownPet)
      : null;

  if (!user) return null;
  if (user.petTask)
    return (
      <Link className="text-sm underline" href="/profile?tab=pet">
        Manage companion task
      </Link>
    );
  return (
    <div className="space-y-2 border-t pt-2">
      {feedback.message && (
        <p role="alert" className="text-destructive text-sm">
          {feedback.message}
        </p>
      )}
      {collection.isPending ? (
        <p className="text-sm">Loading companions...</p>
      ) : collection.error ? (
        <QueryError
          message={collection.error.message}
          retryLabel="Retry"
          retryVariant="link"
          onRetry={() => void collection.refetch()}
        />
      ) : !selected ? (
        <p className="text-muted-foreground text-sm">
          {shownPet && blockReason
            ? `${shownPet.name}: ${blockReason}`
            : petTaskRequirementsText(user.rank)}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selected.id}
            onValueChange={setPetId}
            disabled={start.isPending}
          >
            <SelectTrigger
              aria-label="Companion for contract"
              className="w-full sm:w-48"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {eligible.map((pet) => (
                <SelectItem key={pet.id} value={pet.id}>
                  {pet.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Confirm
            title={`Send ${selected.name} on ${questName}?`}
            disabled={start.isPending}
            button={
              <Button variant="outline" disabled={start.isPending}>
                Send companion
              </Button>
            }
            onAccept={() => start.mutate({ petId: selected.id, questId })}
          >
            <PetTaskTerms minutes={minutes} entryRequirements={entryRequirements} />
          </Confirm>
        </div>
      )}
    </div>
  );
};

/** Both entry points explain the same unattended reward contract and any normal entry charge. */
const PetTaskTerms = ({
  minutes,
  entryRequirements,
}: {
  minutes: number;
  entryRequirements: EntryRequirement[];
}) => (
  <p>
    Your companion will be unavailable for {formatSecondsToTimeDisplay(minutes * 60)}{" "}
    and until you collect its results or return it without rewards. It receives only the
    final quest reward and usual profession drops. Objectives and intermediate rewards
    are not simulated.
    {entryRequirements.length > 0 && (
      <>
        {" "}
        Accepting this contract consumes {formatQuestEntryCost(entryRequirements)} if it
        is not already active.
      </>
    )}
  </p>
);

/** Refresh authoritative task/account state even after a lost response, keeping committed dispatches recoverable. */
const usePetTaskFeedback = () => {
  const { prepareUserUpdate, updateUser } = useRequiredUserData();
  const utils = api.useUtils();
  const openRewardChoice = useOpenRewardChoice();
  const [message, setMessage] = useState("");
  const refresh = () =>
    Promise.all([
      utils.quests.getPetTask.invalidate(),
      utils.quests.specificQuests.invalidate(),
      utils.quests.getQuestHistory.invalidate(),
      utils.quests.getPendingRewardChoices.invalidate(),
      utils.pets.getPet.invalidate(),
      utils.pets.getCollection.invalidate(),
      utils.item.getUserItems.invalidate(),
    ]);
  return {
    message,
    handlers: {
      onMutate: prepareUserUpdate,
      onSuccess: async (
        data: UserDeltaResponse,
        _variables: unknown,
        revision: number | undefined,
      ) => {
        setMessage(data.success ? "" : data.message);
        if (data.success && data.rewards)
          showRewardToast(data.notifications ?? [], data.rewards, data.message);
        else showMutationToast(data);
        if (data.rewardChoicePending) void openRewardChoice();
        await Promise.all([refresh(), updateUser(data, { revision })]);
      },
      onError: async (error: { message: string }) => {
        setMessage(error.message);
        await Promise.all([refresh(), utils.profile.getUser.invalidate()]);
      },
    },
  };
};

type EntryRequirement = { name: string; quantity: number };
