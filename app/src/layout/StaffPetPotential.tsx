"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PET_POTENTIAL_TIERS } from "@/drizzle/constants";
import { useStaffPetPotential } from "@/hooks/useStaffPetPotential";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";

/** Audited individual potential overrides live beside the account's support controls. */
export const StaffPetPotential = ({
  userId,
  username,
}: {
  userId: string;
  username: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [petId, setPetId] = useState("");
  const [value, setValue] = useState(1);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { pets, mutation } = useStaffPetPotential(
    userId,
    isOpen,
    () => {
      setIsOpen(false);
      setReason("");
    },
    setMessage,
  );
  const selected = pets.data?.find((pet) => pet.id === petId);
  return (
    <>
      <Button
        ref={buttonRef}
        variant="outline"
        size="sm"
        onClick={() => {
          setMessage("");
          setIsOpen(true);
        }}
      >
        Edit companion potential
      </Button>
      <Modal
        title={`Companion potential · ${username}`}
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        returnFocusRef={buttonRef}
        keepOpenOnAccept
        proceed_label="Save potential"
        proceed_loading_label="Saving"
        isLoading={mutation.isPending}
        proceedDisabled={!selected || reason.trim().length < 10}
        onAccept={(event) => {
          event.preventDefault();
          if (selected && !mutation.isPending)
            mutation.mutate({ userId, petId: selected.id, value, reason });
        }}
      >
        <fieldset
          aria-label="Companion potential settings"
          className="min-w-0 space-y-3"
          onKeyDown={(event) => {
            // Enter operates the form controls without invoking modal confirmation.
            if (event.key === "Enter") event.stopPropagation();
          }}
        >
          <p className="text-muted-foreground text-sm">
            Set a permanent potential tier from 1–5. This reveals potential and adjusts
            its rank-based training caps. Saved trained stats are kept; battle stats
            respect the new caps. The override and reason are logged.
          </p>
          {pets.isPending ? (
            <Loader explanation="Loading companions" />
          ) : pets.isError ? (
            <Button onClick={() => void pets.refetch()}>
              Retry loading companions
            </Button>
          ) : !pets.data?.length ? (
            <p>This player has no companions.</p>
          ) : (
            <>
              <Label htmlFor="staff-potential-pet">Companion</Label>
              <select
                id="staff-potential-pet"
                className="bg-background w-full rounded border p-2"
                value={petId}
                disabled={mutation.isPending}
                onChange={(event) => {
                  const pet = pets.data.find(
                    (entry) => entry.id === event.target.value,
                  );
                  setPetId(event.target.value);
                  setValue(pet?.potentialValue ?? 1);
                }}
              >
                <option value="">Choose companion</option>
                {pets.data.map((pet) => (
                  <option key={pet.id} value={pet.id}>
                    {pet.name} ·{" "}
                    {
                      PET_POTENTIAL_TIERS.find(
                        (tier) => tier.value === pet.potentialValue,
                      )?.title
                    }{" "}
                    {pet.potentialRevealed ? "" : "(unrevealed)"}
                  </option>
                ))}
              </select>
              <Label htmlFor="staff-potential-value">Potential</Label>
              <select
                id="staff-potential-value"
                className="bg-background w-full rounded border p-2"
                value={value}
                disabled={mutation.isPending}
                onChange={(event) => setValue(Number(event.target.value))}
              >
                {PET_POTENTIAL_TIERS.map((tier) => (
                  <option key={tier.value} value={tier.value}>
                    {tier.title} · {Number((tier.capMultiplier * 100).toFixed(2))}% stat
                    caps
                  </option>
                ))}
              </select>
              <Label htmlFor="staff-potential-reason">
                Reason (at least 10 characters)
              </Label>
              <Textarea
                id="staff-potential-reason"
                value={reason}
                maxLength={500}
                disabled={mutation.isPending}
                onChange={(event) => setReason(event.target.value)}
              />
            </>
          )}
          {message && <p role="alert">{message}</p>}
        </fieldset>
      </Modal>
    </>
  );
};
