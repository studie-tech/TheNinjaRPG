"use client";

import { PawPrint } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PET_MAX_GENERATION_ATTEMPTS } from "@/drizzle/constants";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { showMutationToast } from "@/libs/toast";

/** Support recovery shares the profile's staff toolbar and audited reason workflow. */
export const ResetPetImageGeneration = ({
  userId,
  username,
}: {
  userId: string;
  username: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [petId, setPetId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const utils = api.useUtils();
  const {
    data: pets,
    isPending: isLoading,
    isError,
    refetch,
  } = api.profile.getPetImageGenerationForStaff.useQuery(
    { id: userId },
    { enabled: isOpen },
  );
  const selectedPet = pets?.find((pet) => pet.id === petId);
  const { mutate, isPending } = api.profile.resetPetImageGeneration.useMutation({
    onSuccess: async (data) => {
      if (!data.success) {
        setError(data.message);
        return;
      }
      showMutationToast(data);
      setIsOpen(false);
      setReason("");
      setError("");
      await Promise.all([
        utils.profile.getPetImageGenerationForStaff.invalidate({ id: userId }),
        utils.pets.getCollection.invalidate(),
        utils.pets.getPet.invalidate(),
      ]);
    },
    // Network errors can bypass global toasts; retain the dialog's inputs for retry.
    onError: (cause) => setError(cause.message),
  });
  const canReset = Boolean(
    selectedPet?.generationAttempts && reason.trim().length >= 10,
  );

  return (
    <>
      <TooltipProvider delayDuration={50}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              ref={buttonRef}
              type="button"
              className="rounded-sm hover:text-orange-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Reset companion image attempts for ${username}`}
              onClick={() => {
                setError("");
                setIsOpen(true);
              }}
            >
              <PawPrint className="h-6 w-6" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Reset companion image attempts</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Modal
        title="Reset companion image attempts"
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        returnFocusRef={buttonRef}
        proceed_label="Reset attempts"
        proceed_loading_label="Resetting"
        isLoading={isPending}
        keepOpenOnAccept
        proceedDisabled={!canReset}
        onAccept={(event) => {
          event.preventDefault();
          if (!canReset || isPending) return;
          setError("");
          mutate({ userId, petId, reason: reason.trim() });
        }}
      >
        <div className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Restore {username}&apos;s current-rank image attempts after a generation
            problem. Accepted artwork is kept. Running generations must finish first.
            This action is logged.
          </p>
          {isLoading ? (
            <Loader explanation="Loading companions" />
          ) : isError ? (
            <p className="text-sm">
              Could not load companions.{" "}
              <Button variant="outline" onClick={() => void refetch()}>
                Retry
              </Button>
            </p>
          ) : !pets?.length ? (
            <p className="text-sm">This player has no companions.</p>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="reset-pet-image">Companion</Label>
              <Select
                value={petId}
                onValueChange={(value) => {
                  setPetId(value);
                  setError("");
                }}
                disabled={isPending}
              >
                <SelectTrigger id="reset-pet-image">
                  <SelectValue placeholder="Choose a companion" />
                </SelectTrigger>
                <SelectContent
                  onKeyDown={(event) => {
                    // Enter chooses a companion without reaching the modal's confirmation shortcut.
                    if (event.key === "Enter") event.stopPropagation();
                  }}
                >
                  {pets.map((pet) => (
                    <SelectItem key={pet.id} value={pet.id}>
                      {pet.name} · {pet.generationAttempts}/
                      {PET_MAX_GENERATION_ATTEMPTS} attempts used
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="reset-pet-reason">Reason *</Label>
            <Input
              id="reset-pet-reason"
              value={reason}
              maxLength={500}
              disabled={isPending}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason (minimum 10 characters)..."
            />
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
};
