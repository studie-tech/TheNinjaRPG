"use client";

import { ChevronLeft, ChevronRight, PawPrint, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type RouterInputs } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  PET_GENDER_LABELS,
  PET_OPTION_COUNTS,
  type PetGender,
  PetGenders,
} from "@/drizzle/constants";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import Countdown from "@/layout/Countdown";
import Image from "@/layout/Image";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { PetAppearanceButton } from "@/layout/PetAppearanceButton";
import type { PetAppearanceOption, PetSpeciesOption } from "@/libs/pets/catalogue";
import { getPetRank, isPetAppearanceReady } from "@/libs/pets/progression";
import { showMutationToast } from "@/libs/toast";
import { useRequiredUserData } from "@/utils/UserContext";
import { acquirePetSchema } from "@/validators/pets";
import type { UserDeltaResponse } from "@/validators/userCache";

/**
 * Guide daily trait selection, claim a companion, then request its first artwork.
 * A saved companion survives image failures; uncertain adoption responses are
 * reconciled with the collection before another potentially paid claim is allowed.
 */
export function PetAcquisition() {
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();
  const utils = api.useUtils();
  const [name, setName] = useState("");
  const [gender, setGender] = useState<PetGender | null>(null);
  const [currency, setCurrency] =
    useState<RouterInputs["pets"]["acquirePet"]["currency"]>("REPUTATION");
  const [selection, setSelection] = useState<PetSelection>(emptySelection);
  const [stage, setStage] = useState(0);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [acquiredPetId, setAcquiredPetId] = useState<string | null>(null);
  const [isAcquiring, setIsAcquiring] = useState(false);
  const [needsCollectionCheck, setNeedsCollectionCheck] = useState(false);
  // Lock synchronously across claim, artwork and recovery before pending state paints.
  const inFlight = useRef(false);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const shouldFocusStage = useRef(false);
  // Keep a pre-claim identity snapshot until the server's committed pet is known.
  const adoptionAttempt = useRef<{
    previousIds: Set<string>;
    input: RouterInputs["pets"]["acquirePet"];
  } | null>(null);
  const selectedDay = useRef<string | null>(null);
  const selectedCatalogue = useRef<string | null>(null);
  const { data, isPending, isFetching, error, refetch } = api.pets.getPet.useQuery(
    acquiredPetId ? { petId: acquiredPetId } : undefined,
    {
      enabled: !!userData,
      staleTime: 0,
      refetchOnMount: "always",
      refetchInterval: (query) =>
        isAcquiring || query.state.data?.pet?.generationStatus === "GENERATING"
          ? 3000
          : false,
    },
  );
  const dayKey = data?.dayKey;
  const paymentCost =
    currency === "SEICHI_SILVER"
      ? (data?.replacementSilverCost ?? 0)
      : (data?.replacementCost ?? 0);
  const paymentBalance =
    currency === "SEICHI_SILVER"
      ? (userData?.seichiSilver ?? 0)
      : (userData?.reputationPoints ?? 0);
  const paymentLabel = currency === "SEICHI_SILVER" ? "Seichi Silver" : "reputation";
  const canAfford = paymentBalance >= paymentCost;
  // Day, tier and appearance changes invalidate a draft; adoption only removes a species.
  const catalogueKey = data
    ? `${data.dayKey}:${data.optionCount}:${[
        data.options.palettes,
        data.options.characteristics,
        data.options.auras,
      ]
        .flatMap((options) => options.map(petTraitValue))
        .join(",")}`
    : null;
  useEffect(() => {
    if (!dayKey || !catalogueKey || catalogueKey === selectedCatalogue.current) return;
    if (selectedCatalogue.current) {
      setSelection(emptySelection);
      setStage(0);
      setMessage(
        selectedDay.current !== dayKey
          ? "A new UTC day has begun. Choose from today's refreshed options."
          : "Your available companion traits changed. Review the choices again.",
      );
    }
    selectedDay.current = dayKey;
    selectedCatalogue.current = catalogueKey;
  }, [dayKey, catalogueKey]);
  useEffect(() => {
    if (shouldFocusStage.current) {
      stageHeading.current?.focus();
      shouldFocusStage.current = false;
    }
  }, [stage]);

  const changeStage = (next: number) => {
    shouldFocusStage.current = true;
    setStage(next);
  };

  const finishMutation = async (
    result: UserDeltaResponse,
    _variables: unknown,
    revision: number | undefined,
  ) => {
    setMessage(result.success ? null : result.message);
    showMutationToast(result);
    await Promise.all([
      utils.pets.getPet.invalidate(),
      utils.pets.getCollection.invalidate(),
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
    // A failed response can follow a committed claim; reload before offering another adoption.
    await Promise.all([
      utils.pets.getPet.invalidate(),
      utils.pets.getCollection.invalidate(),
      utils.profile.getUser.invalidate(),
    ]);
  };
  const acquire = api.pets.acquirePet.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: finishMutation,
    onError: failMutation,
  });
  const generate = api.pets.generateAppearance.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: finishMutation,
    onError: failMutation,
  });
  const isBusy =
    needsCollectionCheck || isAcquiring || acquire.isPending || generate.isPending;

  /** Reconcile an uncertain claim against newly added matching pets before enabling another charge. */
  const checkAdoption = async () => {
    const attempt = adoptionAttempt.current;
    if (!attempt) return;
    setNeedsCollectionCheck(true);
    const refreshed = await refetch({ throwOnError: false });
    if (refreshed.error || !refreshed.data) {
      setNeedsCollectionCheck(true);
      setMessage(
        "Your adoption could not be confirmed. Refresh your collection before trying again so you are not charged twice.",
      );
      return;
    }
    const claimed = refreshed.data.pets.find(
      (entry) =>
        !attempt.previousIds.has(entry.id) &&
        entry.name === attempt.input.name &&
        entry.gender === attempt.input.gender &&
        entry.speciesId === attempt.input.speciesId &&
        entry.paletteIndex === attempt.input.paletteIndex &&
        entry.characteristicIndex === attempt.input.characteristicIndex &&
        entry.auraIndex === attempt.input.auraIndex,
    );
    if (claimed) setAcquiredPetId(claimed.id);
    setNeedsCollectionCheck(false);
    adoptionAttempt.current = null;
    setMessage(
      claimed
        ? "Your companion is saved. Retry its appearance for free, or open its profile."
        : "Your collection was checked and no new matching companion was found. You can try adopting again.",
    );
  };

  /** Validate the displayed day's selection, claim once, then generate art for that committed pet. */
  const meetPet = async () => {
    if (inFlight.current || !data?.canAcquire || !canAfford || isBusy) return;
    if (Object.values(selection).some((value) => value === null)) {
      setMessage("Choose one option for each of your companion's four traits.");
      return;
    }
    const parsed = acquirePetSchema.safeParse({
      name,
      gender,
      ...selection,
      dayKey: data.dayKey,
      currency,
    });
    if (!parsed.success) {
      setMessage(
        parsed.error.issues[0]?.message ?? "Review your companion's name and traits.",
      );
      return;
    }
    inFlight.current = true;
    setIsAcquiring(true);
    setMessage(null);
    adoptionAttempt.current = {
      previousIds: new Set(data.pets.map((entry) => entry.id)),
      input: parsed.data,
    };
    try {
      const result = await acquire.mutateAsync(parsed.data);
      if (result.success && result.petId) {
        adoptionAttempt.current = null;
        setAcquiredPetId(result.petId);
        await generate.mutateAsync({ petId: result.petId });
      } else if (result.success) await checkAdoption();
      else adoptionAttempt.current = null;
    } catch {
      // A claimed companion survives image failures and can be retried without a second charge.
      if (adoptionAttempt.current) await checkAdoption();
    } finally {
      inFlight.current = false;
      setIsAcquiring(false);
    }
  };
  /** Resume artwork for the saved companion without re-entering the adoption/charge path. */
  const retryAppearance = async (
    appearance?: RouterInputs["pets"]["generateAppearance"]["appearance"],
  ) => {
    if (inFlight.current || !data?.pet) return;
    inFlight.current = true;
    setIsAcquiring(true);
    setMessage(null);
    try {
      await generate.mutateAsync({
        petId: data.pet.id,
        ...(appearance ? { appearance } : {}),
      });
    } catch {
      // The inline error keeps the companion and retry action visible.
    } finally {
      inFlight.current = false;
      setIsAcquiring(false);
    }
  };

  if (!userData || isPending)
    return <Loader explanation="The Bondkeepers are preparing today's choices..." />;
  if (error || !data)
    return (
      <ContentBox title="Meet your companion" initialBreak>
        <p role="alert" className="mb-3 text-red-600">
          {error?.message ?? "Today's companions could not be loaded."}
        </p>
        <Button
          variant="outline"
          onClick={() => void (needsCollectionCheck ? checkAdoption() : refetch())}
        >
          Try again
        </Button>
      </ContentBox>
    );

  const pet = data.pet;
  const selectedTraits = traitStages.map((trait) =>
    data.options[trait.options].find(
      (option) => petTraitValue(option) === selection[trait.field],
    ),
  );
  const activeTrait = traitStages[stage];
  const hasSelection =
    selectedTraits.every(Boolean) && name.trim().length > 0 && gender !== null;
  const canMeetPet = data.canAcquire && canAfford && hasSelection && !isBusy;
  const isReplacement = data.replacementCost > 0;
  const isCollectionFull = data.pets.length >= data.slots;
  const unavailableReason =
    isCollectionFull && data.slots >= data.maxSlots && data.options.species.length > 0
      ? "Your collection is full. Release a companion before adopting another."
      : data.unavailableReason;
  const appearanceReady = pet ? isPetAppearanceReady(pet) : false;
  const retryAt = data.generationRetryAt;
  const canRetry =
    pet && !appearanceReady && (retryAt === null || retryAt.getTime() <= Date.now());
  // Keep a final in-flight attempt pending until it finishes or its server lease expires.
  const needsAppearanceSupport =
    pet &&
    !appearanceReady &&
    data.remainingGenerations <= 0 &&
    !isBusy &&
    (pet.generationStatus !== "GENERATING" || canRetry);

  return (
    <ContentBox title="Meet your companion" initialBreak>
      {message && (
        <p
          role="alert"
          className="mb-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-red-600"
        >
          {message}
        </p>
      )}
      {needsCollectionCheck && (
        <Button
          variant="outline"
          className="mb-4"
          disabled={isFetching}
          onClick={() => void checkAdoption()}
        >
          {isFetching ? "Checking collection..." : "Refresh collection"}
        </Button>
      )}
      {!acquiredPetId && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">
              {isCollectionFull
                ? "Your collection is full"
                : isReplacement
                  ? `Adoption: ${data.replacementCost} reputation or ${data.replacementSilverCost} Seichi Silver.`
                  : "Your first companion is free."}
            </p>
            {data.pets.length > 0 && (
              <p className="text-muted-foreground text-sm">
                {data.pets.length} / {data.slots} collection slots
              </p>
            )}
          </div>
          {data.pets.length > 0 && (
            <Button variant={isCollectionFull ? "default" : "outline"} asChild>
              <Link href="/profile?tab=pet">Manage my collection</Link>
            </Button>
          )}
        </div>
      )}
      {!acquiredPetId && unavailableReason && (
        <p className="mb-4 text-muted-foreground text-sm" role="status">
          {unavailableReason}
        </p>
      )}
      {/* Keep artwork recovery available even when the collection is full. */}
      {pet && (!appearanceReady || acquiredPetId) && (
        <div
          className={`mb-4 flex rounded border bg-muted/30 ${appearanceReady ? "items-start gap-3 p-3" : "flex-col gap-4 p-4 sm:flex-row sm:items-center"}`}
        >
          <div
            className={`flex shrink-0 items-center justify-center rounded border bg-background ${appearanceReady ? "h-16 w-16" : "h-24 w-24"}`}
          >
            {pet.avatar ? (
              <Image
                src={pet.avatar}
                alt={pet.name}
                width={96}
                height={96}
                className="h-full w-full object-contain"
              />
            ) : (
              <PawPrint
                className="h-12 w-12 text-muted-foreground"
                aria-hidden="true"
              />
            )}
          </div>
          <div className="min-w-0 grow space-y-2">
            <h3 className="break-words font-semibold">
              {pet.name} · {getPetRank(pet.rank).name}
            </h3>
            {!appearanceReady && (
              <p className="text-sm">
                {needsAppearanceSupport
                  ? "Your companion is saved, but its appearance is unfinished."
                  : (pet.generationStatus === "GENERATING" && !canRetry) ||
                      generate.isPending
                    ? "Your companion's image is being created. You can safely return to your pet profile while it finishes."
                    : "Your companion has been claimed. Its appearance must be ready to train and earn experience."}
              </p>
            )}
            {!appearanceReady && (
              <p className="text-muted-foreground text-sm">
                {data.remainingGenerations} / {data.generationLimit} image attempts
                remain for this rank. Only an accepted image uses an attempt, and
                retrying never charges adoption again.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!acquiredPetId && (
                <Button variant="outline" asChild>
                  <Link href={`/profile?tab=pet&petId=${encodeURIComponent(pet.id)}`}>
                    View companion
                  </Link>
                </Button>
              )}
              {needsAppearanceSupport ? (
                <p className="text-sm">
                  <Link href="/support" className="underline">
                    Contact support
                  </Link>{" "}
                  to request an image attempt reset for this companion.
                </p>
              ) : canRetry ? (
                <PetAppearanceButton
                  pet={pet}
                  options={data.options}
                  dayKey={data.dayKey}
                  disabled={
                    isBusy ||
                    data.remainingGenerations <= 0 ||
                    userData.status !== "AWAKE"
                  }
                  onGenerate={retryAppearance}
                >
                  {generate.isPending ? "Creating appearance..." : "Retry appearance"}
                </PetAppearanceButton>
              ) : null}
            </div>
            {!appearanceReady &&
              data.remainingGenerations > 0 &&
              retryAt &&
              !canRetry && (
                <p className="text-muted-foreground text-sm">
                  Appearance retry available in{" "}
                  <Countdown targetDate={retryAt} onFinish={() => void refetch()} />.
                </p>
              )}
          </div>
        </div>
      )}
      {isBusy && (
        <div className="mb-4" aria-live="polite">
          <Loader
            explanation={
              generate.isPending
                ? "Creating your companion's unique image. This can take a few minutes..."
                : "Forming your new bond..."
            }
          />
        </div>
      )}
      {acquiredPetId ? (
        <div className="space-y-3">
          <p>
            {appearanceReady
              ? "Your new companion is ready to join you."
              : "Your bond is saved. You can finish your companion's appearance from its profile."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link
                href={`/profile?tab=pet&petId=${encodeURIComponent(acquiredPetId)}`}
              >
                Open pet profile
              </Link>
            </Button>
            {data.canAcquire && (
              <Button
                variant="outline"
                disabled={isBusy}
                onClick={() => {
                  setAcquiredPetId(null);
                  setName("");
                  setGender(null);
                  setSelection(emptySelection);
                  setStage(0);
                }}
              >
                Meet another companion
              </Button>
            )}
          </div>
        </div>
      ) : (
        <>
          {isCollectionFull && data.options.species.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              className="mb-3 px-0"
              aria-expanded={isPreviewing}
              onClick={() => setIsPreviewing((previous) => !previous)}
            >
              {isPreviewing ? "Hide today's choices" : "Preview today's choices"}
              <ChevronRight
                className={`ml-1 h-4 w-4 ${isPreviewing ? "rotate-90" : ""}`}
                aria-hidden="true"
              />
            </Button>
          )}
          {(!isCollectionFull || isPreviewing) && data.options.species.length > 0 && (
            <div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (isBusy) return;
                  if (activeTrait && selectedTraits[stage]) changeStage(stage + 1);
                  else if (!activeTrait && !isReplacement && canMeetPet) void meetPet();
                }}
              >
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <h3
                    ref={stageHeading}
                    tabIndex={-1}
                    className="font-semibold text-lg"
                  >
                    {activeTrait?.title ?? "Name your companion"}
                  </h3>
                  <span className="shrink-0 text-muted-foreground text-sm">
                    Step {stage + 1} of {traitStages.length + 1}
                  </span>
                </div>
                {activeTrait ? (
                  <PetTraitChoices
                    title={activeTrait.title}
                    field={activeTrait.field}
                    options={data.options[activeTrait.options]}
                    selected={selection[activeTrait.field]}
                    disabled={isBusy}
                    onSelect={(value) =>
                      setSelection((previous) =>
                        activeTrait.field === "speciesId"
                          ? { ...previous, speciesId: String(value) }
                          : { ...previous, [activeTrait.field]: Number(value) },
                      )
                    }
                  />
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="new-pet-name">Companion name</Label>
                    <Input
                      id="new-pet-name"
                      placeholder="Name your companion"
                      value={name}
                      maxLength={40}
                      disabled={isBusy}
                      onChange={(event) => setName(event.target.value)}
                      className="max-w-md"
                    />
                    <fieldset className="pt-2" disabled={isBusy}>
                      <legend className="mb-2 font-medium text-sm">Gender</legend>
                      <RadioGroup
                        aria-label="Companion gender"
                        value={gender ?? ""}
                        className="flex flex-wrap gap-x-5 gap-y-2"
                        onValueChange={(value) => {
                          const next = PetGenders.find((entry) => entry === value);
                          if (next) setGender(next);
                        }}
                      >
                        {PetGenders.map((entry) => (
                          <div key={entry} className="flex items-center gap-2">
                            <RadioGroupItem
                              id={`new-pet-gender-${entry.toLowerCase()}`}
                              value={entry}
                            />
                            <Label htmlFor={`new-pet-gender-${entry.toLowerCase()}`}>
                              {PET_GENDER_LABELS[entry]}
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>
                      <p className="mt-2 text-muted-foreground text-sm">
                        Its artwork follows this choice, e.g. a male lion grows a mane.
                      </p>
                    </fieldset>
                    {isReplacement && (
                      <div className="pt-2">
                        <RadioGroup
                          aria-label="Adoption payment"
                          value={currency}
                          disabled={isBusy}
                          className="flex flex-wrap gap-x-5 gap-y-2"
                          onValueChange={(value) => {
                            if (value === "REPUTATION" || value === "SEICHI_SILVER")
                              setCurrency(value);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <RadioGroupItem
                              id="adoption-reputation"
                              value="REPUTATION"
                            />
                            <Label htmlFor="adoption-reputation">
                              {data.replacementCost} reputation
                            </Label>
                          </div>
                          <div className="flex items-center gap-2">
                            <RadioGroupItem
                              id="adoption-silver"
                              value="SEICHI_SILVER"
                            />
                            <Label htmlFor="adoption-silver">
                              {data.replacementSilverCost} Seichi Silver
                            </Label>
                          </div>
                        </RadioGroup>
                        <p className="mt-2 text-muted-foreground text-sm" role="status">
                          Balance: {paymentBalance.toLocaleString()} {paymentLabel}.
                          {!canAfford &&
                            " Choose another currency or earn more to adopt."}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {selectedTraits.some(Boolean) && (
                  <p
                    role="status"
                    aria-label="Selected traits"
                    className="mt-3 text-muted-foreground text-sm"
                  >
                    {selectedTraits
                      .filter((trait) => trait !== undefined)
                      .map((trait) => trait.name)
                      .join(" · ")}
                  </p>
                )}
                <div
                  className={`mt-4 flex flex-wrap items-center gap-3 ${stage > 0 ? "justify-between" : "justify-end"}`}
                >
                  {stage > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isBusy}
                      onClick={() => changeStage(stage - 1)}
                    >
                      <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                      Back
                    </Button>
                  )}
                  {activeTrait ? (
                    <Button
                      type="button"
                      disabled={isBusy || !selectedTraits[stage]}
                      onClick={() => changeStage(stage + 1)}
                    >
                      Continue
                      <ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
                    </Button>
                  ) : isReplacement ? (
                    <Confirm
                      title={`Form a new bond for ${paymentCost} ${paymentLabel}?`}
                      disabled={!canMeetPet}
                      button={
                        <Button type="button" disabled={!canMeetPet}>
                          <Sparkles className="mr-2 h-4 w-4" />
                          Meet my new companion
                        </Button>
                      }
                      onAccept={() => void meetPet()}
                    >
                      <p className="mb-3">
                        The Bondkeepers will guide you to a new companion. This costs{" "}
                        {paymentCost} {paymentLabel}. Your companion starts at the first
                        rank with new pet stats.
                      </p>
                      <p>
                        New companion: <strong>{name.trim()}</strong> ·{" "}
                        {gender ? `${PET_GENDER_LABELS[gender]} · ` : ""}
                        {selectedTraits
                          .map((trait) => trait?.name)
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </Confirm>
                  ) : (
                    <Button type="submit" disabled={!canMeetPet}>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Meet my first companion
                    </Button>
                  )}
                </div>
              </form>
              <details className="mt-4 text-muted-foreground text-sm">
                <summary className="cursor-pointer">About daily choices</summary>
                <div className="mt-2 space-y-2">
                  <p>
                    Choose a species, colour palette, defining characteristic and aura.
                    The Bondkeepers create a unique image from these appearance traits.
                    Your companion starts at {getPetRank(1).name} and keeps its identity
                    through later evolutions.
                  </p>
                  <p>
                    Today's {data.optionCount} choices per trait reset at midnight UTC (
                    {data.dayKey}). Returning today keeps the same choices. Regular
                    accounts receive {PET_OPTION_COUNTS.NONE} choices per trait; Normal,
                    Silver and Gold federal support gives {PET_OPTION_COUNTS.NORMAL},{" "}
                    {PET_OPTION_COUNTS.SILVER} and {PET_OPTION_COUNTS.GOLD}. Support
                    also improves daily species rarity.
                  </p>
                  <p>
                    Each companion has {data.generationLimit} image attempts per rank,
                    including its first image. Failed generations do not use an attempt.
                  </p>
                  {data.activePetId && (
                    <p>
                      Your active companion stays with you. New companions join your
                      collection with their own stats and experience.
                    </p>
                  )}
                </div>
              </details>
            </div>
          )}
        </>
      )}
    </ContentBox>
  );
}

/** Accessible single-choice controls whose values remain the catalogue's persisted trait IDs. */
function PetTraitChoices({
  title,
  field,
  options,
  selected,
  disabled,
  onSelect,
}: {
  title: string;
  field: keyof PetSelection;
  options: (PetAppearanceOption | PetSpeciesOption)[];
  selected: string | number | null;
  disabled: boolean;
  onSelect: (value: string | number) => void;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="sr-only">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((option) => {
          const value = petTraitValue(option);
          return (
            <label
              key={value}
              className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring ${selected === value ? "border-primary bg-primary/10" : "hover:bg-muted/40"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name={`pet-${field}`}
                value={value}
                checked={selected === value}
                onChange={() => onSelect(value)}
                className="mt-1 accent-primary"
              />
              <span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{option.name}</span>
                  {option.rarity && <Badge variant="outline">{option.rarity}</Badge>}
                </span>
                <span className="mt-1 block text-muted-foreground text-sm">
                  {option.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Species use stable database IDs while authored cosmetic traits retain numeric IDs. */
const petTraitValue = (option: PetAppearanceOption | PetSpeciesOption) =>
  "id" in option ? option.id : option.index;

/** Incomplete wizard draft; null differs from catalogue index zero, which is a valid choice. */
type PetSelection = {
  speciesId: string | null;
  paletteIndex: number | null;
  characteristicIndex: number | null;
  auraIndex: number | null;
};
const emptySelection: PetSelection = {
  speciesId: null,
  paletteIndex: null,
  characteristicIndex: null,
  auraIndex: null,
};

const traitStages = [
  { title: "Species", field: "speciesId", options: "species" },
  { title: "Colour palette", field: "paletteIndex", options: "palettes" },
  {
    title: "Defining characteristic",
    field: "characteristicIndex",
    options: "characteristics",
  },
  { title: "Aura", field: "auraIndex", options: "auras" },
] as const;
