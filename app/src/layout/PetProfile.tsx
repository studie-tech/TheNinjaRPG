"use client";

import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { PawPrint, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api, type RouterInputs } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CombatStatNames,
  MAP_WAKE_ISLAND_SECTOR,
  PET_BATTLE_CONFIG,
  PET_FEED_COOLDOWN_HOURS,
  PET_GENDER_LABELS,
  PET_RANKS,
  PET_REPLACEMENT_COST,
  PET_SANCTUARY_NAME,
  PET_SEICHI_SILVER_COST,
  type PetGender,
  PetGenders,
  PetSpawnPositions,
} from "@/drizzle/constants";
import { useSectorVillage } from "@/hooks/useSectorVillage";
import AiProfileEdit from "@/layout/AiProfileEdit";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import Modal from "@/layout/Modal";
import { PetAppearanceButton } from "@/layout/PetAppearanceButton";
import { PetTasks } from "@/layout/PetTasks";
import DistributeStatsForm from "@/layout/StatsDistributionForm";
import {
  getPetJutsuCost,
  getPetSkillCost,
  validatePetAbilities,
} from "@/libs/pets/abilities";
import { PET_AURAS, PET_CHARACTERISTICS, PET_PALETTES } from "@/libs/pets/catalogue";
import { isPetGenderEditable, PET_GENDER_EDIT_UNTIL_LABEL } from "@/libs/pets/gender";
import {
  canUsePet,
  getPetLevel,
  getPetRank,
  getPetStatCaps,
  isPetAppearanceReady,
} from "@/libs/pets/progression";
import { showMutationToast } from "@/libs/toast";
import { capitalizeFirstLetter } from "@/utils/string";
import { useRequiredUserData } from "@/utils/UserContext";
import { canAccessStructure } from "@/utils/village";
import {
  PET_AI_ACTION_TYPES,
  PET_AI_EFFECT_TYPES,
  updatePetSchema,
} from "@/validators/pets";
import type { UserDeltaResponse } from "@/validators/userCache";

/**
 * Manage the owner's collection and selected companion within the profile tab.
 * Generation polling and shared invalidation reconcile long-running artwork and
 * rewards; the server remains authoritative for eligibility and mutation results.
 */
export function PetProfile() {
  const {
    data: userData,
    timeDiff,
    prepareUserUpdate,
    updateUser,
  } = useRequiredUserData();
  const { sectorVillage } = useSectorVillage(userData);
  const searchParams = useSearchParams();
  const requestedPetId = searchParams.get("petId") ?? undefined;
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const [selectedPetId, setSelectedPetId] = useState(requestedPetId);
  const [selectedMealId, setSelectedMealId] = useState("");
  const [isSlotDialogOpen, setIsSlotDialogOpen] = useState(false);
  const slotButtonRef = useRef<HTMLButtonElement>(null);
  const [slotCurrency, setSlotCurrency] =
    useState<RouterInputs["pets"]["acquirePet"]["currency"]>("REPUTATION");
  const [abilityDraft, setAbilityDraft] = useState<
    RouterInputs["pets"]["updateAbilities"] | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const nameForm = useForm({ defaultValues: { name: "" } });
  const petName = useWatch({ control: nameForm.control, name: "name" });
  const [genderDraft, setGenderDraft] = useState<PetGender | null>(null);
  const [activity, setActivity] = useState("care");
  const [abilitySearch, setAbilitySearch] = useState("");
  const [abilityKind, setAbilityKind] = useState("all");
  const [isEvolving, setIsEvolving] = useState(false);
  // Background progress and feedback belong to the initiating pet, even after selection changes.
  const [generatingPetIds, setGeneratingPetIds] = useState<string[]>([]);
  const [generationMessages, setGenerationMessages] = useState<
    Record<string, string | null>
  >({});
  // The ref rejects duplicate starts before rendering; state drives controls and polling.
  const pendingGenerations = useRef(new Set<string>());
  // Close the gap before React paints pending state, including multi-step evolution.
  const inFlight = useRef(false);
  const petInput = selectedPetId ? { petId: selectedPetId } : undefined;
  // A mount can inherit a request begun before the owner's latest rewards.
  const shouldRefreshOnMount = useRef(
    queryClient.getQueryState(getQueryKey(api.pets.getPet, petInput, "query"))
      ?.fetchStatus === "fetching",
  );
  const { data, isPending, error, refetch } = api.pets.getPet.useQuery(petInput, {
    enabled: !!userData,
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: (query) =>
      generatingPetIds.length > 0 ||
      isEvolving ||
      query.state.data?.pets.some((entry) => entry.generationStatus === "GENERATING")
        ? 3000
        : false,
  });
  const pet = data?.pet;
  const isGenerating = !!pet && generatingPetIds.includes(pet.id);
  const aiProfile = useMemo(
    () =>
      pet ? { rules: pet.aiRules, includeDefaultRules: pet.includeDefaultRules } : null,
    [pet?.aiRules, pet?.includeDefaultRules],
  );
  const ownerExperience = userData?.experience;
  const ownerEarnedExperience = userData?.earnedExperience;
  const ownerPetExperience = userData?.petExperience;
  const ownerUpdatedAt = userData?.updatedAt?.getTime();
  const previousOwnerProgress = useRef([
    ownerUpdatedAt,
    ownerExperience,
    ownerEarnedExperience,
    ownerPetExperience,
  ]);

  useEffect(() => {
    setSelectedPetId(requestedPetId);
    setMessage(null);
  }, [requestedPetId]);
  useEffect(() => {
    if (selectedPetId && data && !data.pets.some((entry) => entry.id === selectedPetId))
      setSelectedPetId(undefined);
  }, [data, selectedPetId]);

  // Training and quest rewards update the player view; the pet bank is fetched separately.
  useEffect(() => {
    const ownerProgress = [
      ownerUpdatedAt,
      ownerExperience,
      ownerEarnedExperience,
      ownerPetExperience,
    ];
    const hasChanged = ownerProgress.some(
      (value, index) => value !== previousOwnerProgress.current[index],
    );
    previousOwnerProgress.current = ownerProgress;
    // Settled-cache mounts already refetch; replace inherited requests only once.
    const shouldRefresh = hasChanged || shouldRefreshOnMount.current;
    shouldRefreshOnMount.current = false;
    if (shouldRefresh) void utils.pets.getPet.invalidate();
  }, [
    ownerUpdatedAt,
    ownerExperience,
    ownerEarnedExperience,
    ownerPetExperience,
    utils,
  ]);
  useEffect(() => {
    nameForm.reset({ name: pet?.name ?? "" });
  }, [pet?.id, pet?.name, nameForm]);
  useEffect(() => {
    setGenderDraft(pet?.gender ?? null);
  }, [pet?.id, pet?.gender]);

  /** Reconcile pet and player views after a committed or uncertain mutation. */
  const invalidatePetData = async () => {
    await Promise.all([
      utils.pets.getPet.invalidate(),
      utils.pets.getCollection.invalidate(),
    ]);
  };
  const finishMutation = async (
    result: UserDeltaResponse,
    _variables: unknown,
    revision: number | undefined,
  ) => {
    setMessage(result.success ? null : result.message);
    showMutationToast(result);
    await Promise.all([
      invalidatePetData(),
      result.success
        ? result.userPatch &&
          Object.keys(result.userPatch).length === 0 &&
          !result.userDelta
          ? undefined
          : updateUser(result.userPatch, {
              revision,
              delta: result.userPatch ? (result.userDelta ?? {}) : undefined,
            })
        : utils.profile.getUser.invalidate(),
    ]);
  };
  const failMutation = async (cause: { message: string }) => {
    setMessage(cause.message);
    // A network failure may arrive after the server commits the update.
    await Promise.all([invalidatePetData(), utils.profile.getUser.invalidate()]);
  };
  const update = api.pets.updatePet.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: finishMutation,
    onError: failMutation,
  });
  const generate = api.pets.generateAppearance.useMutation({
    // Capture the name before the player can rename or switch companions.
    onMutate: ({ petId }) => ({
      name: data?.pets.find((entry) => entry.id === petId)?.name,
    }),
    onSuccess: async (result, { petId }, context) => {
      setGenerationMessages((previous) => ({
        ...previous,
        [petId]: result.success ? null : result.message,
      }));
      showMutationToast({
        ...result,
        message: `${context?.name ?? "Companion"}: ${result.message}`,
      });
      await invalidatePetData();
    },
    onError: async (cause, { petId }, context) => {
      // A dropped connection says nothing about the server: the image may still be accepted.
      const message = `${cause.message.replace(/[.!?]?\s*$/, ".")} The image may still finish; refresh in a few minutes. Failed generations do not use an attempt.`;
      setGenerationMessages((previous) => ({ ...previous, [petId]: message }));
      // A local onError replaces the provider's default toast, so report background failures here.
      showMutationToast({
        success: false,
        message: `${context?.name ?? "Companion"}: ${message}`,
      });
      await invalidatePetData();
    },
  });
  const evolve = api.pets.rankUp.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: finishMutation,
    onError: failMutation,
  });
  const assign = api.pets.assignExperience.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, _variables, revision) => {
      setMessage(result.success ? null : result.message);
      showMutationToast(result);
      if (result.success) {
        await Promise.all([
          updateUser(result.userPatch, { revision }),
          utils.pets.getPet.invalidate(),
          utils.pets.getCollection.invalidate(),
        ]);
      } else {
        await Promise.all([invalidatePetData(), utils.profile.getUser.invalidate()]);
      }
    },
    onError: failMutation,
  });
  const updateAi = api.pets.updateAiConfig.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: finishMutation,
    onError: failMutation,
  });
  const release = api.pets.releasePet.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, variables, revision) => {
      await finishMutation(result, variables, revision);
      if (result.success) setSelectedPetId(undefined);
    },
    onError: failMutation,
  });
  const activate = api.pets.activatePet.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: finishMutation,
    onError: failMutation,
  });
  const unlockSlot = api.pets.unlockSlot.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, variables, revision) => {
      await finishMutation(result, variables, revision);
      if (result.success) setIsSlotDialogOpen(false);
    },
    onError: failMutation,
  });
  const feed = api.pets.feedPet.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, variables, revision) => {
      await Promise.all([
        finishMutation(result, variables, revision),
        utils.item.getUserItems.invalidate(),
      ]);
    },
    onError: failMutation,
  });
  const updateAbilities = api.pets.updateAbilities.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (result, variables, revision) => {
      await finishMutation(result, variables, revision);
      if (result.success) setAbilityDraft(null);
    },
    onError: failMutation,
  });
  const isBusy =
    isEvolving ||
    update.isPending ||
    evolve.isPending ||
    assign.isPending ||
    updateAi.isPending ||
    release.isPending ||
    activate.isPending ||
    unlockSlot.isPending ||
    feed.isPending ||
    updateAbilities.isPending;

  /** Generate or redraw a companion without repeating adoption or rank-up. */
  const generateAppearance = async (
    appearance?: RouterInputs["pets"]["generateAppearance"]["appearance"],
  ) => {
    if (inFlight.current || !pet || isBusy || pendingGenerations.current.has(pet.id))
      return;
    const petId = pet.id;
    // Artwork requests belong to their companion; routine care and collection navigation stay available.
    pendingGenerations.current.add(petId);
    setGeneratingPetIds([...pendingGenerations.current]);
    setGenerationMessages((previous) => ({ ...previous, [petId]: null }));
    try {
      await generate.mutateAsync({
        petId,
        ...(appearance ? { appearance } : {}),
      });
    } catch {
      // Mutation callbacks show a named toast and retain the pet's inline error for retry.
    } finally {
      pendingGenerations.current.delete(petId);
      setGeneratingPetIds([...pendingGenerations.current]);
    }
  };
  /** Commit progression first, then generate its matching form; artwork failure remains retryable. */
  const evolvePet = async () => {
    if (inFlight.current || !pet || pendingGenerations.current.has(pet.id)) return;
    inFlight.current = true;
    setIsEvolving(true);
    setMessage(null);
    setGenerationMessages((previous) => ({ ...previous, [pet.id]: null }));
    try {
      const result = await evolve.mutateAsync({ petId: pet.id });
      if (result.success) await generate.mutateAsync({ petId: pet.id });
    } catch {
      // The new rank is retained if artwork fails; retrying continues that evolution.
    } finally {
      inFlight.current = false;
      setIsEvolving(false);
    }
  };
  /** Report success to the shared allocation form so a rejected spend keeps its draft recoverable. */
  const assignExperience = async (
    stats: Omit<RouterInputs["pets"]["assignExperience"], "petId">,
  ) => {
    if (inFlight.current || !pet) return false;
    inFlight.current = true;
    setMessage(null);
    try {
      return (await assign.mutateAsync({ ...stats, petId: pet.id })).success;
    } catch {
      return false;
    } finally {
      inFlight.current = false;
    }
  };

  if (!userData || isPending) return <Loader explanation="Loading your companion..." />;
  if (error || !data)
    return (
      <ContentBox title="Pet" subtitle="Your companion">
        <p role="alert" className="mb-3 text-red-600">
          {error?.message ?? "Your pet could not be loaded."}
        </p>
        <Button variant="outline" onClick={() => void refetch()}>
          Try again
        </Button>
      </ContentBox>
    );
  // Send players through the existing destination picker instead of a location-gated page.
  const isAtSanctuary = userData.sector === MAP_WAKE_ISLAND_SECTOR;
  const cannotTravel = userData.status !== "AWAKE" || !!userData.battleId;
  const travelReason = cannotTravel
    ? "Return to the awake state outside battle to travel."
    : "";
  const sanctuaryButton =
    !isAtSanctuary && cannotTravel ? (
      <Button variant="outline" disabled>
        Travel to Wake Island
      </Button>
    ) : (
      <Button variant="outline" asChild>
        <Link
          href={isAtSanctuary ? "/pets" : `/travel?sector=${MAP_WAKE_ISLAND_SECTOR}`}
        >
          {isAtSanctuary ? "Open sanctuary" : "Travel to Wake Island"}
        </Link>
      </Button>
    );
  const sanctuaryAction = (
    <div className="space-y-2">
      {sanctuaryButton}
      {!isAtSanctuary && (
        <p className="text-muted-foreground text-sm">
          Adoption takes place at the {PET_SANCTUARY_NAME} on Wake Island.{" "}
          {travelReason}
        </p>
      )}
    </div>
  );
  const homeVillage = userData.village;
  const hasHomeKitchen =
    !!homeVillage &&
    (userData.isOutlaw ||
      homeVillage.structures?.some((structure) => structure.route === "/home"));
  const isAtHome =
    hasHomeKitchen &&
    homeVillage.sector === sectorVillage?.sector &&
    (userData.isOutlaw || canAccessStructure(userData, "/home", sectorVillage));
  const slotCost =
    slotCurrency === "SEICHI_SILVER" ? data.slotSilverCost : data.slotCost;
  const slotBalance =
    slotCurrency === "SEICHI_SILVER"
      ? userData.seichiSilver
      : userData.reputationPoints;
  const slotCurrencyLabel =
    slotCurrency === "SEICHI_SILVER" ? "Seichi Silver" : "reputation";
  const slotBlockMessage =
    userData.status !== "AWAKE" || userData.battleId
      ? "You must be awake and out of combat to unlock a slot."
      : slotBalance < slotCost
        ? `You need ${(slotCost - slotBalance).toLocaleString()} more ${slotCurrencyLabel} to unlock this slot.`
        : null;
  const canUnlockSlot = !isBusy && !slotBlockMessage && data.slots < data.maxSlots;
  const collection = (
    <>
      <ContentBox
        title="Your companions"
        subtitle={`${data.pets.length} / ${data.slots} collection slots`}
      >
        {!pet && message && (
          <p role="alert" className="mb-3 text-red-600">
            {message}
          </p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          {data.pets.length > 0 && (
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="pet-collection">Companion</Label>
              <Select
                value={pet?.id ?? ""}
                disabled={isBusy}
                onValueChange={(petId) => {
                  setSelectedPetId(petId);
                  setMessage(null);
                }}
              >
                <SelectTrigger
                  id="pet-collection"
                  className="min-w-0 [&>span]:truncate"
                >
                  <SelectValue placeholder="Choose a companion" />
                </SelectTrigger>
                <SelectContent>
                  {data.pets.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.name}
                      {entry.id === data.activePetId ? " · Active" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex shrink-0 flex-wrap gap-2">
            {pet && sanctuaryButton}
            {data.slots < data.maxSlots && (
              <Button
                ref={slotButtonRef}
                variant="outline"
                disabled={isBusy}
                onClick={() => {
                  setMessage(null);
                  setIsSlotDialogOpen(true);
                }}
              >
                Add slot
              </Button>
            )}
          </div>
        </div>
        {pet && !isAtSanctuary && cannotTravel && (
          <p className="mt-2 text-muted-foreground text-sm">{travelReason}</p>
        )}
        <details
          className="mt-3 text-muted-foreground text-sm"
          open={data.pets.length > data.slots}
        >
          <summary className="cursor-pointer">
            {data.permanentSlots} permanent{" "}
            {data.permanentSlots === 1 ? "slot" : "slots"}
            {data.bonusSlots > 0 && ` · ${data.bonusSlots} federal support bonus slots`}
          </summary>
          <p className="mt-2 max-w-prose">
            Federal support adds slots while active. Your companions are kept if support
            expires; adopting requires room in your current capacity.
          </p>
        </details>
      </ContentBox>
      {data.slots < data.maxSlots && (
        <Modal
          title="Add a companion slot"
          isOpen={isSlotDialogOpen}
          setIsOpen={setIsSlotDialogOpen}
          returnFocusRef={slotButtonRef}
          proceed_label={`Unlock slot · ${slotCost} ${slotCurrencyLabel}`}
          proceed_loading_label="Unlocking slot..."
          proceedDisabled={!canUnlockSlot}
          isLoading={unlockSlot.isPending}
          keepOpenOnAccept
          onAccept={() => unlockSlot.mutate({ currency: slotCurrency })}
        >
          <p>
            Add one permanent slot to keep up to {data.slots + 1} companions. Choose how
            to pay.
          </p>
          <RadioGroup
            aria-label="Collection slot payment"
            value={slotCurrency}
            disabled={isBusy}
            className="gap-2 py-2"
            onValueChange={(value) => {
              if (value === "REPUTATION" || value === "SEICHI_SILVER")
                setSlotCurrency(value);
            }}
          >
            {[
              {
                value: "REPUTATION",
                label: "reputation",
                cost: data.slotCost,
                balance: userData.reputationPoints,
              },
              {
                value: "SEICHI_SILVER",
                label: "Seichi Silver",
                cost: data.slotSilverCost,
                balance: userData.seichiSilver,
              },
            ].map((option) => (
              <Label
                key={option.value}
                htmlFor={`slot-${option.value}`}
                className="flex cursor-pointer items-center gap-3 rounded-md border p-3"
              >
                <RadioGroupItem
                  id={`slot-${option.value}`}
                  value={option.value}
                  aria-label={`${option.cost} ${option.label}`}
                />
                <span className="flex-1">
                  {option.cost} {option.label}
                </span>
                <span className="text-muted-foreground text-xs">
                  Balance: {option.balance.toLocaleString()}
                </span>
              </Label>
            ))}
          </RadioGroup>
          {slotBlockMessage && (
            <p role="status" className="text-sm">
              {slotBlockMessage}
            </p>
          )}
          {message && (
            <p role="alert" className="text-destructive text-sm">
              {message}
            </p>
          )}
        </Modal>
      )}
    </>
  );

  if (!pet || !aiProfile)
    return (
      <>
        {collection}
        {/* A saved task remains recoverable when no companion row can be selected. */}
        {userData.petTask && (
          <ContentBox
            title="Companion task"
            subtitle="Manage your pending task"
            initialBreak
          >
            <PetTasks petId={userData.petTask.petId} />
          </ContentBox>
        )}
        <ContentBox title="Pet" subtitle="Find a companion on Wake Island" initialBreak>
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <PawPrint className="h-16 w-16 text-muted-foreground" aria-hidden="true" />
            <p className="max-w-lg">
              The {PET_SANCTUARY_NAME} helps you form a bond with a unique creature.
              Choose its species, colours, characteristic and aura, then raise it
              alongside your shinobi.
            </p>
            <p>
              {data.replacementCost === 0
                ? "Your first companion is free."
                : `Your next companion costs ${data.replacementCost} reputation points or ${data.replacementSilverCost} Seichi Silver.`}{" "}
              Visit the sanctuary on Wake Island to meet it.
            </p>
            {sanctuaryAction}
          </div>
        </ContentBox>
      </>
    );

  const rank = getPetRank(pet.rank);
  const level = getPetLevel(pet);
  const caps = getPetStatCaps(pet);
  const appearanceReady = isPetAppearanceReady(pet);
  const rankAllowed = pet.rank <= data.maxRank;
  const isAway = userData.petTask?.petId === pet.id;
  const settingsDisabled = isBusy || isAway || userData.status !== "AWAKE";
  const nextRank = data.nextRank;
  const canEvolve = data.canRankUp && !settingsDisabled && !isGenerating;
  const retryAt = data.generationRetryAt ? new Date(data.generationRetryAt) : null;
  const selectedMeal =
    data.feedMeals.find((meal) => meal.id === selectedMealId) ?? data.feedMeals[0];
  const canRetryGeneration = retryAt
    ? retryAt.getTime() <= Date.now()
    : pet.generationStatus !== "GENERATING";
  // A claim whose lease expired unsettled produced no image and is not charged.
  const generationAbandoned =
    pet.generationStatus === "GENERATING" && !!retryAt && canRetryGeneration;
  // The last attempt can still succeed while its request or server lease is active.
  const needsAppearanceSupport =
    !appearanceReady &&
    data.remainingGenerations <= 0 &&
    !isGenerating &&
    !isEvolving &&
    (pet.generationStatus !== "GENERATING" || canRetryGeneration);
  const appearanceControls = (
    <div className="space-y-2" aria-live="polite">
      <p className="text-muted-foreground text-sm">
        {data.remainingGenerations} / {data.generationLimit} image attempts remain for
        this rank. Only an accepted image uses an attempt. Regenerations keep your saved
        traits.
      </p>
      {needsAppearanceSupport ? (
        <p className="text-sm">
          <Link href="/support" className="underline">
            Contact support
          </Link>{" "}
          to request an image attempt reset for this companion.
        </p>
      ) : canRetryGeneration ? (
        <PetAppearanceButton
          key={pet.id}
          pet={pet}
          options={data.options}
          dayKey={data.dayKey}
          variant={appearanceReady ? "outline" : "default"}
          disabled={
            settingsDisabled ||
            isGenerating ||
            !rankAllowed ||
            data.remainingGenerations <= 0
          }
          onGenerate={generateAppearance}
        >
          {isGenerating || isEvolving
            ? "Creating appearance..."
            : appearanceReady
              ? "Regenerate appearance"
              : "Create / retry appearance"}
        </PetAppearanceButton>
      ) : pet.generationStatus === "GENERATING" ? (
        appearanceReady ? (
          <p className="text-sm" role="status">
            Creating appearance... Your current appearance stays usable.
          </p>
        ) : (
          <Loader explanation="Creating appearance..." />
        )
      ) : null}
      {data.remainingGenerations > 0 && !canRetryGeneration && retryAt && (
        <p className="text-muted-foreground text-sm">
          Appearance retry available in{" "}
          <Countdown targetDate={retryAt} onFinish={() => void refetch()} />.
        </p>
      )}
      {generationMessages[pet.id] && (
        <p role="alert" className="text-red-600 text-sm">
          {generationMessages[pet.id]}
        </p>
      )}
    </div>
  );
  // Adapt only stats/rank for the shared player allocator; its submit handler
  // spends the selected pet's bank through the pets router.
  const statsUser = {
    ...userData,
    offence: pet.offence,
    defence: pet.defence,
    strength: pet.strength,
    speed: pet.speed,
    intelligence: pet.intelligence,
    willpower: pet.willpower,
    rank: rank.minUserRank,
  };
  const traits = [
    pet.species,
    PET_PALETTES[pet.paletteIndex],
    PET_CHARACTERISTICS[pet.characteristicIndex],
    PET_AURAS[pet.auraIndex],
  ];
  // Drafts belong to a pet ID so switching companions cannot apply another's edits.
  // Saved selections missing from current eligible content are omitted from the draft.
  const abilities =
    abilityDraft?.petId === pet.id
      ? abilityDraft
      : {
          jutsuIds: pet.jutsuIds.filter((id) =>
            data.abilities.jutsus.some((entry) => entry.id === id),
          ),
          skillIds: pet.skillIds.filter((id) =>
            data.abilities.skills.some((entry) => entry.id === id),
          ),
        };
  const abilityChoices = [
    ...data.abilities.jutsus.map((entry) => ({
      item: entry,
      field: "jutsuIds" as const,
      cost: getPetJutsuCost(entry),
      label: `Jutsu · ${entry.jutsuRank} rank`,
    })),
    ...data.abilities.skills.map((entry) => ({
      item: entry,
      field: "skillIds" as const,
      cost: getPetSkillCost(entry),
      label: `Skill · Tier ${entry.tier}`,
    })),
  ];
  const selectedAbilityChoices = abilityChoices.filter((choice) =>
    abilities[choice.field].includes(choice.item.id),
  );
  const visibleAbilityChoices = abilityChoices
    .filter(
      (choice) =>
        (abilityKind === "all" || choice.field === abilityKind) &&
        choice.item.name.toLowerCase().includes(abilitySearch.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(abilities[b.field].includes(b.item.id)) -
          Number(abilities[a.field].includes(a.item.id)) ||
        a.item.name.localeCompare(b.item.name),
    );
  const abilityCount = abilities.jutsuIds.length + abilities.skillIds.length;
  const abilityCost = selectedAbilityChoices.reduce(
    (total, choice) => total + choice.cost,
    0,
  );
  const abilityError = validatePetAbilities({
    pet: { ...pet, ...abilities },
    owner: userData,
    ...data.abilities,
  });
  const hasUnavailableAbilities =
    pet.jutsuIds.some(
      (id) => !data.abilities.jutsus.some((entry) => entry.id === id),
    ) ||
    pet.skillIds.some((id) => !data.abilities.skills.some((entry) => entry.id === id));

  return (
    <div className="break-words [&_.self-start]:min-w-0">
      {collection}
      <ContentBox
        title={pet.name}
        subtitle="Train and care for your companion"
        initialBreak
      >
        <div className="flex items-start gap-4">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border bg-muted/30 sm:h-36 sm:w-36">
            {pet.avatar ? (
              <Image
                src={pet.avatar}
                alt={pet.name}
                width={160}
                height={160}
                className="h-full w-full object-contain"
              />
            ) : (
              <PawPrint
                className="h-14 w-14 text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </div>
          <div className="min-w-0 grow space-y-2">
            <div className="flex flex-wrap gap-2">
              <Badge>{rank.name}</Badge>
              <Badge variant="outline">
                Level {level} / {rank.levelCap}
              </Badge>
              <Badge variant="outline">
                Rank {pet.rank} / {PET_RANKS.length}
              </Badge>
              {pet.species && (
                <Badge variant="outline">
                  {capitalizeFirstLetter(pet.species.role)}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {traits
                .map((trait) => trait?.name)
                .filter(Boolean)
                .join(" · ")}
            </p>
            {isAway ? (
              <Badge variant="outline">Away on a task</Badge>
            ) : pet.id === data.activePetId ? (
              <Badge>Active companion</Badge>
            ) : (
              <Button
                size="sm"
                disabled={settingsDisabled}
                onClick={() => activate.mutate({ petId: pet.id })}
              >
                {activate.isPending ? "Activating..." : "Make active companion"}
              </Button>
            )}
            <p className="text-sm">
              <strong>{formatStat(data.unusedExperience)}</strong> experience available
            </p>
          </div>
        </div>
        <dl
          aria-label="Companion stats"
          className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
          {CombatStatNames.map((stat) => (
            <div key={stat} className="rounded border p-2">
              <dt className="text-muted-foreground text-sm">
                {capitalizeFirstLetter(stat)}
              </dt>
              <dd className="font-semibold">
                {formatStat(pet[stat])}
                <span className="font-normal text-muted-foreground text-xs">
                  {" "}
                  /{" "}
                  {formatStat(
                    stat === "offence" || stat === "defence"
                      ? caps.stats_cap
                      : caps.gens_cap,
                  )}
                </span>
              </dd>
            </div>
          ))}
        </dl>
        {pet.species && pet.species.effects.length > 0 && (
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer font-semibold">
              Species skills · {pet.species.effects.length}{" "}
              {pet.species.effects.length === 1 ? "tag" : "tags"}
            </summary>
            <div className="mt-2 space-y-2">
              <p>
                Applies once at battle start when this companion participates in an
                eligible battle.
              </p>
              {pet.species.effects.map((effect, index) => (
                <ItemWithEffects
                  key={`${effect.type}-${index}`}
                  hideDates
                  hideImage
                  hideData
                  item={{
                    id: `species:${pet.species?.id}:${index}`,
                    name: `Tag ${index + 1} · ${effect.skillTarget === "ENEMIES" ? "Enemies" : "Companion and owner"}`,
                    description: "",
                    effects: [effect],
                    createdAt: pet.species?.createdAt,
                    updatedAt: pet.species?.updatedAt,
                  }}
                />
              ))}
            </div>
          </details>
        )}
        {nextRank && (
          <div className="mt-3 space-y-1 text-sm">
            <p>
              {formatStat(pet.experience)} / {formatStat(nextRank.experienceRequired)}{" "}
              assigned experience toward {nextRank.name}
            </p>
            <Progress
              value={Math.min(
                100,
                (pet.experience / nextRank.experienceRequired) * 100,
              )}
              aria-label={`Experience toward ${nextRank.name}`}
            />
          </div>
        )}
        <details className="mt-3 text-muted-foreground text-sm">
          <summary className="cursor-pointer">
            How companion experience and battles work
          </summary>
          <p className="mt-2">
            New player experience also earns experience for your eligible active
            companion. Switching companions keeps each pet's progress and unused
            experience.{" "}
            {PET_BATTLE_CONFIG.enabled
              ? "Companions can join mission, event, story, Battle Pyramid and dungeon quest battles. PvP, arena and automatically resolved challenges exclude companions."
              : "Companion battles are not available yet."}
          </p>
          <p className="mt-2">Assigned experience: {formatStat(pet.experience)}.</p>
        </details>
        {!appearanceReady && (
          <div className="mt-5 space-y-3 rounded border bg-muted/30 p-4">
            <p className="font-semibold">
              {!needsAppearanceSupport &&
              ((pet.generationStatus === "GENERATING" && !generationAbandoned) ||
                isGenerating ||
                isEvolving)
                ? "Your companion's appearance is being created"
                : pet.artRank > 0
                  ? "Finish your companion's evolution"
                  : "Create your companion's appearance"}
            </p>
            <p className="text-sm">
              {needsAppearanceSupport ? (
                "Your companion is saved, but its appearance is unfinished."
              ) : (
                <>
                  {(pet.generationStatus === "FAILED" || generationAbandoned) &&
                  data.remainingGenerations > 0 &&
                  !isGenerating &&
                  !isEvolving
                    ? "The last image attempt did not finish, so it did not use an attempt. A retry only uses one if its image is accepted."
                    : "Your pet can train and earn experience after its appearance is ready."}{" "}
                  Creating the image can take a few minutes.
                </>
              )}
            </p>
            {appearanceControls}
          </div>
        )}
        {!rankAllowed && (
          <p className="mt-4 rounded border bg-muted/30 p-3" role="status">
            {data.maxRank > 0
              ? `Your current shinobi rank supports companions up to ${getPetRank(data.maxRank).name}.`
              : "Your current shinobi rank does not support this companion rank."}{" "}
            This pet keeps its progress. Reach the required shinobi rank to continue
            training and evolution.
          </p>
        )}
        {userData.status !== "AWAKE" && (
          <p className="mt-4 text-sm" role="status">
            Return to the awake state to change your pet's settings or allocate
            experience.
          </p>
        )}

        {isAway && (
          <p className="mt-3 rounded border bg-muted/30 p-3 text-sm" role="status">
            {pet.name} is away on a task.{" "}
            <button
              type="button"
              className="font-medium underline"
              onClick={() => setActivity("tasks")}
            >
              Open Tasks
            </button>{" "}
            to see its progress or collect its return. You can manage your other
            companions while it is away.
          </p>
        )}
        {message && (
          <p
            role="alert"
            className="mt-3 rounded border border-red-500/40 bg-red-500/10 p-3 text-red-600"
          >
            {message}
          </p>
        )}
      </ContentBox>
      <Tabs value={activity} onValueChange={setActivity} className="mt-4">
        <TabsList
          aria-label="Companion activities"
          className="grid grid-cols-3 sm:grid-cols-6"
        >
          <TabsTrigger
            value="care"
            className="min-h-9 whitespace-normal px-1 text-xs leading-tight sm:text-sm"
          >
            Care
          </TabsTrigger>
          <TabsTrigger value="training" className="min-h-9 px-1 text-xs sm:text-sm">
            Training
          </TabsTrigger>
          <TabsTrigger value="abilities" className="min-h-9 px-1 text-xs sm:text-sm">
            Abilities
          </TabsTrigger>
          <TabsTrigger value="battle" className="min-h-9 px-1 text-xs sm:text-sm">
            Battle
          </TabsTrigger>
          <TabsTrigger value="tasks" className="min-h-9 px-1 text-xs sm:text-sm">
            Tasks
          </TabsTrigger>
          <TabsTrigger value="settings" className="min-h-9 px-1 text-xs sm:text-sm">
            Settings
          </TabsTrigger>
        </TabsList>
        <TabsContent value="care" forceMount hidden={activity !== "care"}>
          <ContentBox
            title="Feed your companion"
            subtitle={`Share a meal every ${PET_FEED_COOLDOWN_HOURS} hours`}
            alreadyHasH1
          >
            <p className="mb-3 text-sm">
              {selectedMeal
                ? `One ${selectedMeal.rarity.toLowerCase()} meal adds ${formatStat(selectedMeal.experience)} unused pet experience to ${pet.name}.`
                : "Meals add unused pet experience according to their rarity."}{" "}
              Assign these points in the Training tab.
            </p>
            {data.feedAvailableAt ? (
              <p role="status">
                Next meal available in{" "}
                <Countdown
                  targetDate={data.feedAvailableAt}
                  timeDiff={timeDiff}
                  onFinish={() => void refetch()}
                />
                .
              </p>
            ) : data.feedMeals.length === 0 ? (
              <div className="space-y-3">
                <p>Keep a finished meal in your inventory to feed your companion.</p>
                {isAtHome ? (
                  <Button variant="outline" asChild>
                    <Link href="/home?panel=kitchen">Open kitchen</Link>
                  </Button>
                ) : hasHomeKitchen ? (
                  <>
                    <p className="text-muted-foreground text-sm">
                      Cook meals in your home kitchen in {homeVillage.name}.{" "}
                      {travelReason}
                    </p>
                    {cannotTravel ? (
                      <Button variant="outline" disabled>
                        Travel home to cook
                      </Button>
                    ) : (
                      <Button variant="outline" asChild>
                        <Link href={`/travel?sector=${homeVillage.sector}`}>
                          Travel home to cook
                        </Link>
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Your current village does not have a home kitchen.
                  </p>
                )}
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-0 grow basis-48 space-y-2">
                  <Label htmlFor="pet-feed-meal">Meal</Label>
                  <Select
                    value={selectedMeal?.id ?? ""}
                    onValueChange={setSelectedMealId}
                    disabled={settingsDisabled || !data.canFeed}
                  >
                    <SelectTrigger id="pet-feed-meal">
                      <SelectValue placeholder="Choose a meal" />
                    </SelectTrigger>
                    <SelectContent>
                      {data.feedMeals.map((meal) => (
                        <SelectItem key={meal.id} value={meal.id}>
                          {meal.name} · {capitalizeFirstLetter(meal.rarity)} ·{" "}
                          {formatStat(meal.experience)} XP · {meal.quantity} available
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Confirm
                  title={`Feed ${selectedMeal?.name ?? "a meal"} to ${pet.name}?`}
                  disabled={settingsDisabled || !data.canFeed || !selectedMeal}
                  button={
                    <Button
                      disabled={settingsDisabled || !data.canFeed || !selectedMeal}
                    >
                      {feed.isPending ? "Feeding..." : "Feed one meal"}
                    </Button>
                  }
                  onAccept={() =>
                    selectedMeal &&
                    feed.mutate({
                      petId: pet.id,
                      userItemId: selectedMeal.id,
                      expectedQuantity: selectedMeal.quantity,
                    })
                  }
                >
                  <p>
                    Use one {selectedMeal?.name} (
                    {selectedMeal && capitalizeFirstLetter(selectedMeal.rarity)}) to
                    give {pet.name} {formatStat(selectedMeal?.experience ?? 0)} unused
                    experience.
                  </p>
                </Confirm>
                {!data.canFeed && (
                  <p className="w-full text-muted-foreground text-sm">
                    {isAway
                      ? "Collect this companion's return in Tasks before feeding it."
                      : "Finish this companion's appearance, meet its shinobi rank requirement and return to the awake state to feed it."}
                  </p>
                )}
              </div>
            )}
          </ContentBox>
        </TabsContent>
        <TabsContent value="training" forceMount hidden={activity !== "training"}>
          <div>
            <DistributeStatsForm
              key={`${pet.id}:${pet.rank}`}
              userData={statsUser}
              availableStats={Math.floor(data.unusedExperience)}
              onAccept={assignExperience}
              includeMasteries={false}
              advanceTutorial={false}
              disabled={
                settingsDisabled ||
                !rankAllowed ||
                !appearanceReady ||
                data.unusedExperience < 1
              }
              title="Assign Pet Experience"
              subtitle={`${formatStat(data.unusedExperience)} points available for your companion${isAway ? " · Collect its return in Tasks before training" : !rankAllowed ? " · Your shinobi rank must support this pet" : !appearanceReady ? " · Finish its appearance to allocate points" : userData.status !== "AWAKE" ? " · You must be awake to allocate points" : data.unusedExperience < 1 ? " · Earn player experience with an eligible active companion to allocate points" : ""}`}
              isPending={assign.isPending}
            />
          </div>

          <ContentBox
            title="Evolution"
            subtitle="Grow the same companion through ten ranks"
            initialBreak
          >
            <p className="mb-3">
              Each evolution builds on your pet's previous portrait, preserving its
              species, colours and distinctive traits. Your shinobi rank and assigned
              pet experience determine when it can evolve.
            </p>
            {nextRank ? (
              <div className="space-y-3">
                <p>
                  Next: <strong>{nextRank.name}</strong> ·{" "}
                  {formatStat(nextRank.experienceRequired)} assigned experience ·{" "}
                  {nextRank.minUserRank} shinobi rank
                </p>
                <Confirm
                  title={`Evolve ${pet.name} to ${nextRank.name}?`}
                  className="break-words [&>div]:min-w-0"
                  disabled={!canEvolve}
                  button={
                    <Button disabled={!canEvolve}>
                      <Sparkles className="mr-2 h-4 w-4" />
                      {isEvolving ? "Evolving..." : `Evolve to ${nextRank.name}`}
                    </Button>
                  }
                  onAccept={() => void evolvePet()}
                >
                  <p>
                    Your pet advances to rank {nextRank.rank}, then receives an evolved
                    portrait based on its current image. If image creation fails, you
                    can retry this evolution for free.
                  </p>
                </Confirm>
                {data.rankUpReason && (
                  <p className="text-muted-foreground text-sm">{data.rankUpReason}</p>
                )}
              </div>
            ) : (
              <p>Your companion has reached its final evolution.</p>
            )}
            <details className="mt-5">
              <summary className="cursor-pointer font-semibold">
                All pet ranks and requirements
              </summary>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="p-2">Rank</th>
                      <th className="p-2">Companion</th>
                      <th className="p-2">Shinobi rank</th>
                      <th className="p-2">Experience</th>
                      <th className="p-2">Level cap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PET_RANKS.map((entry) => (
                      <tr
                        key={entry.rank}
                        className={entry.rank === pet.rank ? "bg-muted" : "border-b"}
                      >
                        <td className="p-2">{entry.rank}</td>
                        <td className="p-2">{entry.name}</td>
                        <td className="whitespace-nowrap p-2">{entry.minUserRank}</td>
                        <td className="p-2">{formatStat(entry.experienceRequired)}</td>
                        <td className="p-2">{entry.levelCap}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </ContentBox>
        </TabsContent>
        <TabsContent value="abilities" forceMount hidden={activity !== "abilities"}>
          <ContentBox
            title="Companion abilities"
            subtitle="Choose pet jutsu and share your activated skills"
            alreadyHasH1
          >
            <p className="mb-3 text-sm">
              Choose published pet jutsu and your activated passive skills within your
              companion's slots and power budget. Species rarity determines its slots;
              pet rank and level determine availability. Unselect an ability to make
              room. Jutsu start at level 1 and scale with your pet.
            </p>
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge variant="outline">
                {abilityCount} / {data.abilityCapacity?.maxSlots ?? 0} slots used
              </Badge>
              <Badge variant="outline">
                {abilityCost} / {data.abilityCapacity?.budget ?? 0} power budget
              </Badge>
            </div>
            {hasUnavailableAbilities && (
              <p className="mb-3 text-sm" role="status">
                Saved abilities that are no longer supported are omitted. Save this
                selection to remove them.
              </p>
            )}
            <div className="rounded border bg-muted/30 p-3">
              <p className="font-semibold text-sm">Selected loadout</p>
              <p className="mt-1 text-sm">
                {selectedAbilityChoices.length
                  ? selectedAbilityChoices.map((choice) => choice.item.name).join(" · ")
                  : "No abilities selected."}
              </p>
              {abilityError && (
                <p role="alert" className="mt-3 text-red-600 text-sm">
                  {abilityError}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  disabled={settingsDisabled || Boolean(abilityError)}
                  onClick={() =>
                    updateAbilities.mutate({ ...abilities, petId: pet.id })
                  }
                >
                  {updateAbilities.isPending ? "Saving..." : "Save abilities"}
                </Button>
                <Button
                  variant="outline"
                  disabled={settingsDisabled || abilityCount === 0}
                  onClick={() =>
                    setAbilityDraft({ petId: pet.id, jutsuIds: [], skillIds: [] })
                  }
                >
                  Clear selection
                </Button>
              </div>
            </div>
            <div className="my-3 flex gap-2">
              <div className="min-w-0 grow space-y-1">
                <Label htmlFor="pet-ability-search">Find an ability</Label>
                <Input
                  id="pet-ability-search"
                  placeholder="Search by name"
                  value={abilitySearch}
                  onChange={(event) => setAbilitySearch(event.target.value)}
                />
              </div>
              <div className="w-28 space-y-1">
                <Label htmlFor="pet-ability-kind">Type</Label>
                <Select value={abilityKind} onValueChange={setAbilityKind}>
                  <SelectTrigger id="pet-ability-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="jutsuIds">Jutsu</SelectItem>
                    <SelectItem value="skillIds">Skills</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <fieldset
              className="max-h-80 space-y-1 overflow-y-auto overscroll-contain rounded border p-1"
              aria-label="Available companion abilities"
            >
              {visibleAbilityChoices.map((choice) => {
                const selected = abilities[choice.field].includes(choice.item.id);
                const next = {
                  ...abilities,
                  [choice.field]: selected
                    ? abilities[choice.field].filter((id) => id !== choice.item.id)
                    : [...abilities[choice.field], choice.item.id],
                };
                const blocked = validatePetAbilities({
                  pet: { ...pet, ...next },
                  owner: userData,
                  ...data.abilities,
                });
                const id = `pet-ability-${choice.field}-${choice.item.id}`;
                return (
                  <div
                    key={id}
                    className={`rounded p-2 ${selected ? "bg-primary/10" : "bg-muted/30"}`}
                  >
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={id}
                        checked={selected}
                        disabled={
                          settingsDisabled ||
                          !rankAllowed ||
                          (!selected && Boolean(blocked))
                        }
                        onCheckedChange={() =>
                          setAbilityDraft({ ...next, petId: pet.id })
                        }
                      />
                      <Label htmlFor={id} className="grow leading-snug">
                        {choice.item.name}{" "}
                        <span className="mt-1 block font-normal text-muted-foreground text-xs">
                          {choice.label} · {choice.cost} power
                        </span>
                      </Label>
                    </div>
                    <details className="mt-1 ml-7 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        Effects and requirements
                      </summary>
                      <div className="mt-2">
                        {!selected && blocked && (
                          <p className="mb-2 text-muted-foreground">{blocked}</p>
                        )}
                        <ItemWithEffects item={choice.item} hideDates />
                      </div>
                    </details>
                  </div>
                );
              })}
              {visibleAbilityChoices.length === 0 && abilityChoices.length > 0 && (
                <p className="p-2 text-sm">No abilities match your search.</p>
              )}
              {abilityChoices.length === 0 && (
                <p className="text-sm">
                  No compatible pet jutsu are published yet. Activate standalone self
                  skills to share them with your companion.
                </p>
              )}
            </fieldset>
            {data.abilityCapacity && (
              <p className="mt-3 text-muted-foreground text-sm">
                {pet.species ? capitalizeFirstLetter(pet.species.rarity) : "These"}{" "}
                companions have {data.abilityCapacity.maxSlots} slots from adoption.
                Evolving increases the power budget.
              </p>
            )}
          </ContentBox>
        </TabsContent>
        <TabsContent value="battle" forceMount hidden={activity !== "battle"}>
          <ContentBox title="Battle settings" alreadyHasH1>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="pet-spawn-position">Starting position</Label>
                <Select
                  value={pet.spawnPosition}
                  disabled={settingsDisabled}
                  onValueChange={(value) => {
                    const position = PetSpawnPositions.find((entry) => entry === value);
                    if (position)
                      update.mutate({ petId: pet.id, spawnPosition: position });
                  }}
                >
                  <SelectTrigger id="pet-spawn-position">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PetSpawnPositions.map((position) => (
                      <SelectItem key={position} value={position}>
                        {PET_SPAWN_LABELS[position]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="pet-battle-enabled"
                  checked={PET_BATTLE_CONFIG.enabled && pet.battleEnabled}
                  aria-describedby="pet-battle-availability"
                  disabled={
                    !PET_BATTLE_CONFIG.enabled ||
                    settingsDisabled ||
                    (!pet.battleEnabled && (!rankAllowed || !appearanceReady))
                  }
                  onCheckedChange={(battleEnabled) =>
                    update.mutate({ petId: pet.id, battleEnabled })
                  }
                />
                <Label htmlFor="pet-battle-enabled">Join me in battle</Label>
                <Badge variant="outline">
                  {!PET_BATTLE_CONFIG.enabled
                    ? "Unavailable"
                    : !isAway && pet.id === data.activePetId && canUsePet(pet, userData)
                      ? "Ready for PvE"
                      : "Paused"}
                </Badge>
              </div>
            </div>
            <p
              id="pet-battle-availability"
              className="mt-3 text-muted-foreground text-sm"
            >
              {PET_BATTLE_CONFIG.enabled
                ? "Companions join mission, event, story, Battle Pyramid and dungeon quest battles only. They do not participate in PvP, arena or automatically resolved challenges."
                : "Companion battles are not available yet."}
            </p>
          </ContentBox>
          <div className="mt-4">
            <AiProfileEdit
              key={pet.id}
              userData={{ aiProfileId: null, userId: pet.id, jutsus: [], items: [] }}
              availableActionTypes={PET_AI_ACTION_TYPES}
              availableActionEffects={PET_AI_EFFECT_TYPES}
              configuration={{
                profile: aiProfile,
                isSaving: updateAi.isPending,
                disabled: settingsDisabled || !rankAllowed,
                onSave: (profile) => updateAi.mutate({ ...profile, petId: pet.id }),
              }}
            />
            <p className="mt-3 text-muted-foreground text-sm">
              Pet rules control battle actions, including compatible equipped jutsu.
            </p>
          </div>
        </TabsContent>
        <TabsContent value="tasks" forceMount hidden={activity !== "tasks"}>
          <PetTasks petId={pet.id} />
        </TabsContent>
        <TabsContent value="settings" forceMount hidden={activity !== "settings"}>
          <ContentBox title="Companion settings" alreadyHasH1>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-4">
                <Form {...nameForm}>
                  <form
                    onSubmit={nameForm.handleSubmit(({ name }) => {
                      const parsed = updatePetSchema.safeParse({ petId: pet.id, name });
                      if (!parsed.success) {
                        nameForm.setError(
                          "name",
                          {
                            message: !name.trim()
                              ? "Enter a companion name."
                              : "Use 1–40 characters without control characters.",
                          },
                          { shouldFocus: true },
                        );
                        return;
                      }
                      nameForm.clearErrors("name");
                      setMessage(null);
                      update.mutate(parsed.data);
                    })}
                  >
                    <FormField
                      control={nameForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Companion name</FormLabel>
                          <div className="flex gap-2">
                            <FormControl>
                              <Input
                                {...field}
                                maxLength={40}
                                disabled={settingsDisabled}
                                onChange={(event) => {
                                  field.onChange(event);
                                  nameForm.clearErrors("name");
                                }}
                              />
                            </FormControl>
                            <Button
                              type="submit"
                              variant="outline"
                              disabled={settingsDisabled || petName.trim() === pet.name}
                            >
                              Save
                            </Button>
                          </div>
                          <FormMessage role="alert" />
                        </FormItem>
                      )}
                    />
                  </form>
                </Form>
                {/* TODO: remove the editable branch after PET_GENDER_EDIT_UNTIL (26 Nov 2026). */}
                {isPetGenderEditable() ? (
                  <form
                    className="space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!genderDraft || genderDraft === pet.gender) return;
                      setMessage(null);
                      update.mutate({ petId: pet.id, gender: genderDraft });
                    }}
                  >
                    <Label htmlFor="pet-gender">Gender</Label>
                    <div className="flex gap-2">
                      <Select
                        value={genderDraft ?? ""}
                        disabled={
                          settingsDisabled || pet.generationStatus === "GENERATING"
                        }
                        onValueChange={(value) => {
                          const next = PetGenders.find((entry) => entry === value);
                          if (next) setGenderDraft(next);
                        }}
                      >
                        <SelectTrigger id="pet-gender" className="w-full">
                          <SelectValue placeholder="Not set" />
                        </SelectTrigger>
                        <SelectContent>
                          {PetGenders.map((entry) => (
                            <SelectItem key={entry} value={entry}>
                              {PET_GENDER_LABELS[entry]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        type="submit"
                        variant="outline"
                        aria-label="Save gender"
                        disabled={
                          settingsDisabled ||
                          pet.generationStatus === "GENERATING" ||
                          !genderDraft ||
                          genderDraft === pet.gender
                        }
                      >
                        Save
                      </Button>
                    </div>
                    <p className="text-muted-foreground text-sm">
                      Changeable until {PET_GENDER_EDIT_UNTIL_LABEL}, without using an
                      image attempt.{" "}
                      {appearanceReady
                        ? "Regenerate to redraw with it."
                        : "The next image follows it."}
                    </p>
                  </form>
                ) : (
                  <div className="space-y-1.5">
                    <Label>Gender</Label>
                    <p className="text-sm">
                      {pet.gender ? PET_GENDER_LABELS[pet.gender] : "Not set"}
                    </p>
                  </div>
                )}
              </div>
              {appearanceReady && (
                <div className="space-y-1.5">
                  <Label>Appearance</Label>
                  {appearanceControls}
                </div>
              )}
            </div>
          </ContentBox>
          <ContentBox
            title="Release companion"
            subtitle="Return your pet to the sanctuary"
            initialBreak
          >
            <p className="mb-4">
              Releasing {pet.name} removes its progress and unused experience. Your
              other companions stay in your collection. A new companion at the{" "}
              {PET_SANCTUARY_NAME} on Wake Island costs {PET_REPLACEMENT_COST}{" "}
              reputation points or {PET_SEICHI_SILVER_COST} Seichi Silver.
            </p>
            <Confirm
              title={`Release ${pet.name}?`}
              className="break-words [&>div]:min-w-0"
              disabled={
                settingsDisabled ||
                isGenerating ||
                (pet.generationStatus === "GENERATING" && !canRetryGeneration)
              }
              button={
                <Button
                  variant="destructive"
                  disabled={
                    settingsDisabled ||
                    isGenerating ||
                    (pet.generationStatus === "GENERATING" && !canRetryGeneration)
                  }
                >
                  {release.isPending ? "Releasing..." : "Release companion"}
                </Button>
              }
              onAccept={() => release.mutate({ petId: pet.id })}
            >
              <p>
                {pet.name} will return to the sanctuary. Its stats, rank and artwork are
                removed, including its unused experience. Your next adoption will cost{" "}
                {PET_REPLACEMENT_COST} reputation points or {PET_SEICHI_SILVER_COST}{" "}
                Seichi Silver.
              </p>
            </Confirm>
          </ContentBox>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const formatStat = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const PET_SPAWN_LABELS: Record<(typeof PetSpawnPositions)[number], string> = {
  BEHIND: "Behind you",
  LEFT: "Left of you",
  RIGHT: "Right of you",
  FRONT: "In front of you",
};
