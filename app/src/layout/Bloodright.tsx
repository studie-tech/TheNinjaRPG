"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  COST_SKILL_RESET,
  MAX_BLOODRIGHT_OPTIONS,
  SKILL_TREE_RESET_FREE,
} from "@/drizzle/constants";
import { useBloodrightMutations } from "@/hooks/bloodright";
import { BloodrightChanges } from "@/layout/BloodrightChanges";
import Confirm from "@/layout/Confirm";
import Image from "@/layout/Image";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { QueryError } from "@/layout/QueryError";
import { isBloodrightCurrent } from "@/libs/bloodrightEffects";
import { freeResetNote } from "@/libs/skillReset";
import { isStaffMember } from "@/utils/permissions";
import { useRequiredUserDataSelector, useUserDataSelector } from "@/utils/UserContext";

export const Bloodright = () => {
  const { data: user } = useRequiredUserDataSelector((u) => ({
    seichiSilver: u.seichiSilver,
    bloodline: u.bloodline,
  }));
  const { data, isPending, isError, refetch } = api.bloodright.get.useQuery();
  const { purchase, refund } = useBloodrightMutations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const isMutating = purchase.isPending || refund.isPending;
  if (isPending || !user) return <Loader explanation="Loading Bloodright" />;
  if (isError)
    return (
      <QueryError message="Unable to load Bloodright." onRetry={() => void refetch()} />
    );
  const options = data?.options ?? [];
  const purchased = data?.purchased ?? [];
  const selected = options.find((option) => option.id === selectedId);
  const isOwned = purchased.some((entry) => entry.optionId === selectedId);
  const current =
    !!selected?.jutsu && isBloodrightCurrent(selected.changes, selected.jutsu.effects);
  const jutsus = [
    ...new Map(
      options.flatMap((option) =>
        option.jutsu ? [[option.jutsu.id, option.jutsu] as const] : [],
      ),
    ).values(),
  ];
  const errors = (
    <>
      {[purchase.data, refund.data].map((result, index) =>
        result && !result.success ? (
          <p key={index} role="alert" className="text-destructive">
            {result.message}
          </p>
        ) : null,
      )}
    </>
  );
  return (
    <div className="space-y-4">
      {user.bloodline && (
        <div className="bg-card flex items-center gap-4 rounded-lg border p-3">
          <Image
            src={user.bloodline.image}
            alt={user.bloodline.name}
            width={64}
            height={64}
            className="h-16 w-16 rounded-full object-cover"
          />
          <div>
            <p className="text-muted-foreground text-xs uppercase">Bloodright</p>
            <h3 className="text-lg font-bold">{user.bloodline.name}</h3>
            <p>Rank {user.bloodline.rank}</p>
          </div>
        </div>
      )}
      <p>
        {purchased.length} / {MAX_BLOODRIGHT_OPTIONS} active options ·{" "}
        {data?.spent.toLocaleString()} Seichi Silver invested ·{" "}
        {user.seichiSilver.toLocaleString()} available
      </p>
      <p className="text-muted-foreground text-sm">
        Each option improves only its named jutsu and its evolutions and reskins. Flat
        increases apply first, then percentage increases add together. Bloodright is
        disabled in ranked combat. Changing bloodlines refunds all invested Silver.
      </p>
      {!options.length && (
        <p>No Bloodright options are available for this bloodline.</p>
      )}
      {jutsus.map((jutsu) => (
        <section key={jutsu.id} className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-3">
            <Image
              src={jutsu.image}
              alt={jutsu.name}
              width={48}
              height={48}
              className="h-12 w-12 rounded object-cover"
            />
            <h4 className="font-bold">{jutsu.name}</h4>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {options
              .filter((option) => option.jutsuId === jutsu.id)
              .map((option) => (
                <button
                  type="button"
                  key={option.id}
                  className="bg-card hover:bg-accent space-y-2 rounded-md border p-3 text-left"
                  onClick={() => {
                    purchase.reset();
                    refund.reset();
                    setSelectedId(option.id);
                    setIsOpen(true);
                  }}
                >
                  <div className="flex justify-between gap-2">
                    <b>{option.name}</b>
                    {purchased.some((entry) => entry.optionId === option.id) && (
                      <span className="text-primary">Active</span>
                    )}
                  </div>
                  <p className="text-sm">{option.description}</p>
                  <BloodrightChanges changes={option.changes} effects={jutsu.effects} />
                  <p className="text-muted-foreground text-sm">
                    {option.seichiSilverCost.toLocaleString()} Seichi Silver
                  </p>
                  {!isBloodrightCurrent(option.changes, jutsu.effects) && (
                    <p className="text-destructive text-sm">
                      Awaiting a content update
                    </p>
                  )}
                </button>
              ))}
          </div>
        </section>
      ))}
      {selected && (
        <Modal
          title={selected.name}
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          isLoading={isMutating}
          className="max-w-2xl"
        >
          <p className="font-bold">{selected.jutsu?.name}</p>
          <p>{selected.description}</p>
          {selected.jutsu && (
            <BloodrightChanges
              changes={selected.changes}
              effects={selected.jutsu.effects}
            />
          )}
          <p>
            {selected.seichiSilverCost.toLocaleString()} Seichi Silver
            {isOwned ? " · Active" : ""}
          </p>
          {isOwned ? (
            <Confirm
              disabled={isMutating}
              confirmDisabled={isMutating}
              title="Refund Bloodright option"
              button={
                <Button variant="outline" disabled={isMutating}>
                  Refund option
                </Button>
              }
              onAccept={() => refund.mutate({ optionId: selected.id })}
            >
              Remove this option and refund its original Seichi Silver cost?
            </Confirm>
          ) : (
            <Button
              disabled={
                isMutating ||
                !current ||
                user.seichiSilver < selected.seichiSilverCost ||
                purchased.length >= MAX_BLOODRIGHT_OPTIONS
              }
              onClick={() => purchase.mutate({ optionId: selected.id })}
            >
              {current ? "Activate option" : "Awaiting content update"}
            </Button>
          )}
          {errors}
        </Modal>
      )}
      {purchased
        .filter((entry) => !options.some((option) => option.id === entry.optionId))
        .map((entry) => (
          <Confirm
            key={entry.optionId}
            disabled={isMutating}
            confirmDisabled={isMutating}
            title="Refund unavailable option"
            button={
              <Button variant="outline" disabled={isMutating}>
                Refund unavailable option ({entry.cost} Silver)
              </Button>
            }
            onAccept={() => refund.mutate({ optionId: entry.optionId })}
          >
            Refund this option at its original purchase cost?
          </Confirm>
        ))}
      {(!selected || !isOpen) && errors}
    </div>
  );
};

export const ResetBloodright = () => {
  const { data: user } = useUserDataSelector((u) => ({ staffAccount: u.staffAccount }));
  const { reset } = useBloodrightMutations();
  const { data: info, isError, refetch } = api.skillTree.getResetInfo.useQuery();
  return (
    <div className="space-y-4 p-4">
      <p>
        Reset all Bloodright options and refund all invested Seichi Silver. Bloodright
        and Skills share the monthly reset allowance: {SKILL_TREE_RESET_FREE.NORMAL}{" "}
        free reset, or {SKILL_TREE_RESET_FREE.GOLD} with Gold Federal. After that,
        resets cost {COST_SKILL_RESET} reputation points.
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
        Remove all Bloodright options and refund your Seichi Silver
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
