"use client";

import { Check, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MAX_PLAYER_LEVEL } from "@/drizzle/constants";
import { useNavigationRouter as useRouter } from "@/hooks/navigation";
import { BattleSetupPanel } from "@/layout/battlearena/BattleSetupPanel";
import { OpponentFinder } from "@/layout/battlearena/OpponentFinder";
import { sparExamProgress } from "@/libs/battleArena";
import { showMutationToast } from "@/libs/toast";
import { pushToCombat } from "@/utils/routing";
import { capitalizeFirstLetter } from "@/utils/string";
import { useRequiredUserDataSelector } from "@/utils/UserContext";

/** Sparring: exam progress, challenges to and from you, and players to challenge. */
export function SparringMode() {
  const {
    data: userData,
    pusher,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((u) => ({
    userId: u.userId,
    userQuests: u.userQuests,
    questData: u.questData,
  }));
  const utils = api.useUtils();
  const router = useRouter();
  const [useRankedRules, setUseRankedRules] = useState(false);
  const [spectatable, setSpectatable] = useState(false);

  const { data: challenges } = api.sparring.getUserChallenges.useQuery(undefined, {
    staleTime: 5000,
    enabled: !!userData,
  });

  const { mutate: create, isPending: isCreating } =
    api.sparring.createChallenge.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) await utils.sparring.getUserChallenges.invalidate();
      },
    });

  const { mutate: accept, isPending: isAccepting } =
    api.sparring.acceptChallenge.useMutation({
      onMutate: prepareUserUpdate,
      onSuccess: async (data, _variables, revision) => {
        showMutationToast(data);
        if (data.userRecovery || (data.success && data.battleId))
          await updateUser(data, { revision, refetch: false });
        if (data.success && data.battleId) {
          await Promise.all([
            utils.sparring.getUserChallenges.invalidate(),
            utils.pvpRank.getRankedLoadout.invalidate(),
          ]);
          pushToCombat(router, data.battleId);
        }
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const { mutate: reject, isPending: isRejecting } =
    api.sparring.rejectChallenge.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) await utils.sparring.getUserChallenges.invalidate();
      },
    });

  const { mutate: cancel, isPending: isCancelling } =
    api.sparring.cancelChallenge.useMutation({
      onSuccess: async (data) => {
        showMutationToast(data);
        if (data.success) await utils.sparring.getUserChallenges.invalidate();
      },
    });

  if (!userData) return null;

  const exam = sparExamProgress(userData);
  const isAnswering = isAccepting || isRejecting || isCancelling;
  const challengedIds = new Set(
    challenges
      ?.filter((c) => c.senderId === userData.userId && c.status === "PENDING")
      .map((c) => c.receiverId),
  );

  return (
    <div className="flex flex-col gap-3 @min-[600px]:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {exam && (
          <section
            aria-label="Exam progress"
            className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40"
          >
            <div className="flex justify-between gap-2 text-sm">
              <b>
                {exam.questName} · win {exam.target} spars
              </b>
              <b>
                {exam.done} / {exam.target}
              </b>
            </div>
            <div className="h-2 rounded-full bg-amber-200 dark:bg-amber-900">
              <div
                className="bg-primary h-2 rounded-full"
                style={{ width: `${(exam.done / exam.target) * 100}%` }}
              />
            </div>
          </section>
        )}
        {challenges && challenges.length > 0 && (
          <section className="flex flex-col gap-1.5">
            <h2 className="text-base font-bold">Challenges</h2>
            <ul aria-label="Challenges" className="flex flex-col gap-1.5">
              {challenges.map((challenge) => {
                const isIncoming = challenge.receiverId === userData.userId;
                const other = isIncoming ? challenge.sender : challenge.receiver;
                const isPending = challenge.status === "PENDING";
                const options = [
                  challenge.useRankedRules ? "Ranked rules" : "Normal rules",
                  challenge.spectatable ? "spectators allowed" : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <li
                    key={challenge.id}
                    className={`bg-card flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm ${
                      isPending && isIncoming ? "border-amber-500" : ""
                    } ${isPending ? "" : "opacity-70"}`}
                  >
                    <span className="min-w-0 flex-1">
                      {isIncoming ? (
                        <>
                          <b>{other.username}</b> challenged you
                        </>
                      ) : (
                        <>
                          You challenged <b>{other.username}</b>
                        </>
                      )}
                      <span className="text-muted-foreground block text-xs">
                        Lv {other.level} {capitalizeFirstLetter(other.rank)}
                        {other.village ? ` · ${other.village.name}` : ""} · {options}
                        {isPending
                          ? ""
                          : ` · ${capitalizeFirstLetter(challenge.status)}`}
                      </span>
                    </span>
                    {isPending && isIncoming && (
                      <span className="flex gap-1.5">
                        <Button
                          className="h-11"
                          disabled={isAnswering}
                          onClick={() =>
                            accept({
                              id: challenge.id,
                              originSocketId: pusher?.connection.socket_id,
                            })
                          }
                        >
                          <Check className="mr-1 h-4 w-4" aria-hidden /> Accept
                        </Button>
                        <Button
                          variant="outline"
                          className="h-11"
                          disabled={isAnswering}
                          onClick={() => reject({ id: challenge.id })}
                        >
                          <X className="mr-1 h-4 w-4" aria-hidden /> Decline
                        </Button>
                      </span>
                    )}
                    {isPending && !isIncoming && (
                      <Button
                        variant="outline"
                        className="h-11"
                        disabled={isAnswering}
                        onClick={() => cancel({ id: challenge.id })}
                      >
                        <Trash2 className="mr-1 h-4 w-4" aria-hidden /> Cancel
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        <OpponentFinder
          challengedIds={challengedIds}
          isChallenging={isCreating}
          onChallenge={(targetId) => create({ targetId, useRankedRules, spectatable })}
        />
      </div>
      <BattleSetupPanel action={null}>
        <p className="text-muted-foreground text-xs font-semibold">
          Your challenges use
        </p>
        <OptionCheckbox
          checked={useRankedRules}
          onChange={setUseRankedRules}
          label="Ranked rules"
          hint={`Ranked loadouts, level ${MAX_PLAYER_LEVEL} stats, no LP rewards`}
        />
        <OptionCheckbox
          checked={spectatable}
          onChange={setSpectatable}
          label="Allow spectators"
        />
      </BattleSetupPanel>
    </div>
  );
}

/** A challenge option; rendered in both the rail and the phone sheet, so ids are per instance. */
function OptionCheckbox({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2 text-sm">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <label htmlFor={id}>
        {label}
        {hint && <span className="text-muted-foreground block text-xs">{hint}</span>}
      </label>
    </div>
  );
}
