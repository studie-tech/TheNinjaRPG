"use client";

import { useState } from "react";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  COST_SKILL_RESET,
  MAX_BLOODRIGHT_TIERS,
  SKILL_TREE_RESET_FREE,
} from "@/drizzle/constants";
import { BloodrightTree } from "@/layout/BloodrightTree";
import Confirm from "@/layout/Confirm";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { QueryError } from "@/layout/QueryError";
import { freeResetNote } from "@/libs/skillReset";
import { showMutationToast } from "@/libs/toast";
import { isStaffMember } from "@/utils/permissions";
import { useRequiredUserDataSelector, useUserDataSelector } from "@/utils/UserContext";
import type { userDeltaResponseSchema } from "@/validators/userCache";

export const Bloodright = () => {
  const utils = api.useUtils();
  const {
    data: user,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserDataSelector((u) => ({ seichiSilver: u.seichiSilver }));
  const { data, isPending, isError, refetch } = api.bloodright.get.useQuery();
  const onSuccess = async (
    result: z.infer<typeof userDeltaResponseSchema>,
    _input: unknown,
    revision: number | undefined,
  ) => {
    showMutationToast(result);
    if (result.success)
      await Promise.all([
        utils.bloodright.get.invalidate(),
        updateUser(result.userPatch, {
          revision,
          delta: result.userPatch?.bloodright ? result.userDelta : undefined,
        }),
      ]);
  };
  const purchase = api.bloodright.purchase.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess,
  });
  const refund = api.bloodright.refund.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const isMutating = purchase.isPending || refund.isPending;
  if (isPending) return <Loader explanation="Loading Bloodright" />;
  if (isError)
    return (
      <QueryError message="Unable to load Bloodright." onRetry={() => void refetch()} />
    );
  if (!data?.tiers.length && !data?.purchased.length)
    return <p>No Bloodright Path for this Bloodline</p>;
  const purchasedIds = data?.purchased.map((entry) => entry.skillId) ?? [];
  const isTierModalOpen = isOpen && data?.tiers.some((tier) => tier.id === selectedId);
  const mutationErrors = (
    <>
      {purchase.data && !purchase.data.success && (
        <p role="alert" className="text-destructive">
          {purchase.data.message}
        </p>
      )}
      {refund.data && !refund.data.success && (
        <p role="alert" className="text-destructive">
          {refund.data.message}
        </p>
      )}
    </>
  );
  return (
    <div className="space-y-4">
      <p>
        {purchasedIds.length} / {MAX_BLOODRIGHT_TIERS} active tiers ·{" "}
        {data?.spent.toLocaleString()} Seichi Silver invested ·{" "}
        {user?.seichiSilver.toLocaleString()} available
      </p>
      <p className="text-muted-foreground text-sm">
        Changing bloodlines refunds all invested Silver. Refunding a tier removes it and
        every dependent tier, returning their original purchase costs.
      </p>
      <BloodrightTree
        tiers={data?.tiers ?? []}
        purchasedIds={purchasedIds}
        silver={user?.seichiSilver ?? 0}
        onSelect={(id) => {
          if (!purchase.isPending) purchase.reset();
          if (!refund.isPending) refund.reset();
          setSelectedId(id);
          setIsOpen(true);
        }}
      />
      {data?.tiers
        .filter((tier) => tier.id === selectedId)
        .map((tier) => {
          const isOwned = purchasedIds.includes(tier.id);
          const hasPrerequisites = tier.requiredSkillIds.every((id) =>
            purchasedIds.includes(id),
          );
          return (
            <Modal
              key={tier.id}
              title={tier.name}
              isOpen={isOpen}
              setIsOpen={setIsOpen}
              isLoading={isMutating}
              className="max-w-2xl"
            >
              <ItemWithEffects item={tier} />
              <p>
                Tier {tier.tier} · {tier.seichiSilverCost.toLocaleString()} Seichi
                Silver
                {isOwned ? " · Active" : ""}
              </p>
              {tier.requiredSkillIds.length > 0 && (
                <p className="text-sm">
                  Requires:{" "}
                  {tier.requiredSkillIds
                    .map(
                      (id) =>
                        data.tiers.find((entry) => entry.id === id)?.name ??
                        "Purchased prerequisite",
                    )
                    .join(", ")}
                </p>
              )}
              {isOwned ? (
                <Confirm
                  disabled={isMutating}
                  confirmDisabled={isMutating}
                  title="Refund Bloodright tier"
                  button={
                    <Button disabled={isMutating} variant="outline">
                      Refund tier
                    </Button>
                  }
                  onAccept={() => refund.mutate({ skillId: tier.id })}
                >
                  Remove this tier and all dependent tiers and refund their original
                  Seichi Silver costs?
                </Confirm>
              ) : (
                <Button
                  disabled={
                    isMutating ||
                    !hasPrerequisites ||
                    (user?.seichiSilver ?? 0) < tier.seichiSilverCost ||
                    purchasedIds.length >= MAX_BLOODRIGHT_TIERS
                  }
                  onClick={() => purchase.mutate({ skillId: tier.id })}
                >
                  {!hasPrerequisites ? "Prerequisites required" : "Unlock tier"}
                </Button>
              )}
              {mutationErrors}
            </Modal>
          );
        })}
      {data?.purchased
        .filter((entry) => !data.tiers.some((tier) => tier.id === entry.skillId))
        .map((entry) => (
          <Confirm
            disabled={isMutating}
            confirmDisabled={isMutating}
            key={entry.skillId}
            title="Refund unavailable tier"
            button={
              <Button disabled={isMutating} variant="outline">
                Refund unavailable tier ({entry.cost} Silver)
              </Button>
            }
            onAccept={() => refund.mutate({ skillId: entry.skillId })}
          >
            Refund this tier and all dependents?
          </Confirm>
        ))}
      {!isTierModalOpen && mutationErrors}
    </div>
  );
};

export const ResetBloodright = () => {
  const utils = api.useUtils();
  const {
    data: user,
    prepareUserUpdate,
    updateUser,
  } = useUserDataSelector((u) => ({
    staffAccount: u.staffAccount,
  }));
  const { data: info, isError, refetch } = api.skillTree.getResetInfo.useQuery();
  const reset = api.bloodright.reset.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _input, revision) => {
      showMutationToast(result);
      if (result.success)
        await Promise.all([
          utils.bloodright.get.invalidate(),
          updateUser(result.userPatch, {
            revision,
            delta:
              result.userPatch?.bloodright &&
              result.userPatch.bloodrightSpent !== undefined &&
              result.userPatch.monthlySkillResets
                ? result.userDelta
                : undefined,
          }),
          utils.skillTree.getResetInfo.invalidate(),
        ]);
    },
  });
  return (
    <div className="space-y-4 p-4">
      <p>
        Reset all Bloodright tiers and refund all invested Seichi Silver. Bloodright and
        Skills share the monthly reset allowance: {SKILL_TREE_RESET_FREE.NORMAL} free
        reset, or {SKILL_TREE_RESET_FREE.GOLD} with Gold Federal. After that, resets
        cost {COST_SKILL_RESET} reputation points.
      </p>
      <Confirm
        disabled={!info || reset.isPending}
        confirmDisabled={!info || reset.isPending}
        title="Reset Bloodright"
        button={
          <Button disabled={!info || reset.isPending}>
            {info?.isFree
              ? `Reset Bloodright (${freeResetNote(
                  !!user && isStaffMember(user),
                  info.freeResetsRemaining,
                )})`
              : `Reset Bloodright for ${COST_SKILL_RESET} Reps`}
          </Button>
        }
        onAccept={() => reset.mutate()}
      >
        Remove all Bloodright tiers and refund your Seichi Silver
        {info?.isFree ? " for free" : ` for ${COST_SKILL_RESET} reputation points`}?
      </Confirm>
      {isError && (
        <QueryError
          message="Unable to load your reset allowance."
          retryVariant="outline"
          onRetry={() => void refetch()}
        />
      )}
      {reset.data && !reset.data.success && (
        <p role="alert" className="text-destructive">
          {reset.data.message}
        </p>
      )}
    </div>
  );
};
