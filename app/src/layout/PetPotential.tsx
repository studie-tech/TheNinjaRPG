"use client";
import { useState } from "react";
import type { RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  PET_EXPERIENCE_TRANSFER_COST,
  PET_EXPERIENCE_TRANSFER_MAX_PERCENT,
  PET_POTENTIAL_TIERS,
} from "@/drizzle/constants";
import { usePetPotential } from "@/hooks/usePetPotential";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { getPetPotentialTier } from "@/libs/pets/potential";

/** Reveal permanent potential and preview same-species progression transfers. */
export const PetPotential = ({
  pet,
  pets,
  disabled,
}: {
  pet: NonNullable<RouterOutputs["pets"]["getPet"]["pet"]>;
  pets: RouterOutputs["pets"]["getPet"]["pets"];
  disabled: boolean;
}) => {
  const { reveal, transfer, message, isPending } = usePetPotential();
  const [destinationId, setDestinationId] = useState("");
  const [amountText, setAmountText] = useState("");
  const destinations = pets.filter(
    (entry) => entry.id !== pet.id && entry.speciesId === pet.speciesId,
  );
  const destination = destinations.find((entry) => entry.id === destinationId);
  const amount = Number(amountText);
  const maxTransfer = Math.floor(
    (pet.experience * PET_EXPERIENCE_TRANSFER_MAX_PERCENT) / 100,
  );
  const tier =
    pet.potentialValue === null ? null : getPetPotentialTier(pet.potentialValue);
  const isDisabled = disabled || isPending;
  const hasInvalidAmount =
    amountText !== "" &&
    (!Number.isSafeInteger(amount) || amount < 1 || amount > maxTransfer);
  return (
    <ContentBox
      title="Companion potential"
      subtitle="Potential raises rank-based training caps."
    >
      <div className="space-y-4">
        <p>
          {tier
            ? `${tier.title} · ${Number((tier.capMultiplier * 100).toFixed(2))}% of rank stat caps`
            : "Potential unrevealed. Your companion can still train, evolve and battle."}
        </p>
        {!tier && (
          <>
            {pet.potentialChances.length > 0 && (
              <p className="text-muted-foreground text-sm">
                Possible potential:{" "}
                {PET_POTENTIAL_TIERS.map((tier, index) => ({
                  ...tier,
                  chance: pet.potentialChances[index] ?? 0,
                }))
                  .filter((entry) => entry.chance > 0)
                  .map(
                    (entry) =>
                      `${entry.title} ${Number((entry.chance * 100).toFixed(2))}%`,
                  )
                  .join(" · ")}
              </p>
            )}
            <Confirm
              title="Reveal companion potential"
              disabled={isDisabled}
              button={
                <Button disabled={isDisabled}>
                  {reveal.isPending ? "Revealing..." : "Reveal potential"}
                </Button>
              }
              onAccept={() => reveal.mutate({ petId: pet.id })}
            >
              <p>
                Reveal {pet.name}&apos;s permanent adoption roll. Each companion has one
                result and cannot reroll. Revealing activates its cap bonus; it does not
                grant stats or change HP.
              </p>
            </Confirm>
          </>
        )}
        <p className="text-muted-foreground text-sm">
          All six stat caps keep their evolution-rank proportions. Potential adds up to{" "}
          {((PET_POTENTIAL_TIERS[4].capMultiplier - 1) * 100).toFixed(0)}% training
          room; stats still require XP. HP and abilities are unchanged.
        </p>
        <details className="border-t pt-3">
          <summary className="cursor-pointer font-semibold">
            Transfer assigned experience
          </summary>
          <div className="mt-3 space-y-2">
            <p className="text-muted-foreground text-sm">
              Move up to {PET_EXPERIENCE_TRANSFER_MAX_PERCENT}% of {pet.name}&apos;s
              assigned XP to another companion of the same species for{" "}
              {PET_EXPERIENCE_TRANSFER_COST.toLocaleString()} ryo. Source stats decrease
              proportionally; its evolution and artwork stay. The destination receives
              unused XP to train within its own caps. Both companions are kept.
            </p>
            {!destinations.length ? (
              <p className="text-sm">
                Adopt another companion of this species to transfer experience.
              </p>
            ) : maxTransfer < 1 ? (
              <p className="text-sm">
                Assign experience to this companion before transferring it.
              </p>
            ) : (
              <>
                <Label htmlFor={`pet-transfer-destination-${pet.id}`}>
                  Destination companion
                </Label>
                <select
                  className="bg-background w-full rounded border p-2"
                  id={`pet-transfer-destination-${pet.id}`}
                  value={destinationId}
                  disabled={isDisabled}
                  onChange={(event) => setDestinationId(event.target.value)}
                >
                  <option value="">Choose destination</option>
                  {destinations.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name} ·{" "}
                      {entry.potentialValue === null
                        ? "Unrevealed"
                        : getPetPotentialTier(entry.potentialValue).title}
                    </option>
                  ))}
                </select>
                <Label htmlFor={`pet-transfer-amount-${pet.id}`}>
                  Assigned XP to move (maximum {maxTransfer.toLocaleString()})
                </Label>
                <NumberInput
                  id={`pet-transfer-amount-${pet.id}`}
                  min={1}
                  max={maxTransfer}
                  step={1}
                  value={amountText}
                  disabled={isDisabled}
                  onTextChange={setAmountText}
                  aria-invalid={hasInvalidAmount}
                />
                {hasInvalidAmount && (
                  <p role="status" className="text-destructive text-sm">
                    Enter a whole number from 1 to {maxTransfer.toLocaleString()}.
                  </p>
                )}
                {destination &&
                  Number.isSafeInteger(amount) &&
                  amount > 0 &&
                  amount <= maxTransfer && (
                    <>
                      <p className="text-sm">
                        {pet.name}: {pet.experience.toLocaleString()} →{" "}
                        {(pet.experience - amount).toLocaleString()} assigned XP.{" "}
                        {destination.name}: +{amount.toLocaleString()} unused XP. XP
                        lost: 0. Cost: {PET_EXPERIENCE_TRANSFER_COST.toLocaleString()}{" "}
                        ryo.
                      </p>
                      <Confirm
                        title={`Transfer from ${pet.name} to ${destination.name}`}
                        disabled={isDisabled}
                        button={
                          <Button disabled={isDisabled}>
                            {transfer.isPending
                              ? "Transferring..."
                              : "Transfer experience"}
                          </Button>
                        }
                        onAccept={() =>
                          transfer.mutate({
                            petId: pet.id,
                            destinationPetId: destination.id,
                            amount,
                          })
                        }
                      >
                        <p>
                          Move {amount.toLocaleString()} assigned XP from {pet.name} to{" "}
                          {destination.name}&apos;s unused XP bank and pay{" "}
                          {PET_EXPERIENCE_TRANSFER_COST.toLocaleString()} ryo.{" "}
                          {pet.name}
                          &apos;s trained stats will decrease proportionally. This
                          transfer can only be reversed by paying for another eligible
                          transfer.
                        </p>
                      </Confirm>
                    </>
                  )}
              </>
            )}
          </div>
        </details>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </div>
    </ContentBox>
  );
};
