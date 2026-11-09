"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { noCase } from "change-case";
import { Loader2 } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import {
  BasicElementName,
  ELEMENTAL_MASTERY_BOOST,
  ELEMENTAL_MASTERY_CAP,
  IMG_TRAIN_BUKI_OFF,
  IMG_TRAIN_GEN_OFF,
  IMG_TRAIN_INTELLIGENCE,
  IMG_TRAIN_NIN_OFF,
  IMG_TRAIN_SPEED,
  IMG_TRAIN_STRENGTH,
  IMG_TRAIN_TAI_OFF,
  IMG_TRAIN_WILLPOWER,
} from "@/drizzle/constants";
import { useLocalStorage } from "@/hooks/localstorage";
import { useTutorialStep } from "@/hooks/tutorial";
import Confirm from "@/layout/Confirm";
import ContentBox from "@/layout/ContentBox";
import { getElementImg } from "@/layout/ElementImage";
import Image from "@/layout/Image";
import NavTabs from "@/layout/NavTabs";
import SliderField from "@/layout/SliderField";
import { canAttemptAwakeAction } from "@/libs/actionReadiness";
import { providedElements } from "@/libs/elementalMastery";
import { withCappedStats } from "@/libs/profile";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { isInArray } from "@/utils/array";
import { round } from "@/utils/math";
import { capitalizeFirstLetter } from "@/utils/string";
import { type AssignableUserStats, createStatSchema } from "@/validators/combat";
import { createAssignedExperienceSchema } from "@/validators/user";

interface StatDistributionProps {
  id?: string;
  userData: NonNullable<UserWithRelations>;
  availableStats: number;
  /** Returning false preserves the draft after an expected server rejection. */
  onAccept: (
    data: AssignableUserStats,
  ) => void | Promise<void> | Promise<boolean | undefined>;
  includeMasteries?: boolean;
  forceUseAll?: boolean;
  isRedistribution?: boolean;
  showWrapper?: boolean;
  title?: string;
  subtitle?: string;
  defaultBackHref?: string;
  isPending: boolean;
  /** Let callers describe their own mutation while reusing allocation validation and inputs. */
  pendingLabel?: string;
  /** Companion allocation does not advance the player's character-training tutorial. */
  advanceTutorial?: boolean;
  disabled?: boolean;
}

/** Shared capped stat allocation, including caller-owned pending/rejection state and optional masteries. */
const DistributeStatsForm: React.FC<StatDistributionProps> = (props) => {
  // Destructure
  const {
    id,
    includeMasteries = false,
    forceUseAll,
    isRedistribution,
    userData,
    availableStats,
    onAccept,
    showWrapper = true,
    title = "Distribute Stats",
    subtitle,
    defaultBackHref,
    isPending,
    pendingLabel = "Assigning",
    advanceTutorial = true,
    disabled = false,
  } = props;

  // Tab state - force Advanced mode for redistribution
  const [tab, setTab] = useState<"Simple" | "Advanced">(
    isRedistribution || includeMasteries ? "Advanced" : "Simple",
  );

  // Tutorial hook
  const { currentStep, completeTutorialAction } = useTutorialStep();

  const handleAcceptWithTutorial = async (data: AssignableUserStats) => {
    const shouldAdvance = advanceTutorial && currentStep?.advanceOn === "assignStats";
    if (shouldAdvance) {
      const formSum = sumStatValues(data);

      if (formSum !== availableStats) {
        showMutationToast({
          success: false,
          message: "You must assign all points to your stats to continue.",
        });
        return false;
      }
    }
    // The next step reads the newly assigned XP to decide whether a level is
    // available. Advance only after the caller has accepted and applied it.
    const accepted = await onAccept(data);
    if (shouldAdvance && accepted === true) await completeTutorialAction("assignStats");
    return typeof accepted === "boolean" ? accepted : undefined;
  };

  // NavTabs component - hide for redistribution
  const navTabs = !isRedistribution ? (
    <div
      aria-disabled={isPending || disabled}
      inert={disabled || undefined}
      className={isPending || disabled ? "pointer-events-none opacity-50" : undefined}
    >
      <NavTabs
        id="stats-distribution-tab"
        current={tab}
        options={["Simple", "Advanced"] as const}
        onChange={(value) => {
          if (!isPending) setTab(value as "Simple" | "Advanced");
        }}
      />
    </div>
  ) : null;

  // Content to render
  const content = (
    <fieldset
      disabled={disabled}
      inert={disabled || undefined}
      className={disabled ? "opacity-60" : undefined}
    >
      {!showWrapper && navTabs && (
        <div className="mb-2 flex justify-end">{navTabs}</div>
      )}
      {includeMasteries && (
        <p className="mb-3 text-muted-foreground text-sm">
          Masteries and elements use unused XP without granting level XP. Elements have
          their own {ELEMENTAL_MASTERY_CAP.toLocaleString()} cap and unlock a{" "}
          {ELEMENTAL_MASTERY_BOOST}% damage boost at full mastery. Select one mastered
          element in Combat Preferences.
        </p>
      )}
      {tab === "Simple" && !isRedistribution ? (
        <SimpleDistribution
          includeMasteries={includeMasteries}
          userData={userData}
          availableStats={availableStats}
          onAccept={handleAcceptWithTutorial}
          isPending={isPending}
          pendingLabel={pendingLabel}
        />
      ) : (
        <AdvancedDistribution
          userData={userData}
          availableStats={availableStats}
          onAccept={handleAcceptWithTutorial}
          includeMasteries={includeMasteries}
          forceUseAll={forceUseAll}
          isRedistribution={isRedistribution}
          isPending={isPending}
          pendingLabel={pendingLabel}
        />
      )}
    </fieldset>
  );

  // Show component with or without wrapper
  if (showWrapper) {
    return (
      <ContentBox
        id={id}
        title={title}
        subtitle={subtitle}
        defaultBackHref={defaultBackHref}
        topRightContent={navTabs}
      >
        {content}
      </ContentBox>
    );
  }

  return content;
};

/**
 * Simple Distribution Component - Image-based stat selection
 */
interface SimpleDistributionProps {
  includeMasteries?: boolean;
  userData: NonNullable<UserWithRelations>;
  availableStats: number;
  onAccept: StatDistributionProps["onAccept"];
  isPending: boolean;
  pendingLabel?: string;
}

/** Presets only assign unused experience; redistribution always uses the advanced form. */
const SimpleDistribution: React.FC<SimpleDistributionProps> = (props) => {
  const {
    includeMasteries = false,
    userData,
    availableStats,
    onAccept,
    isPending,
    pendingLabel = "Assigning",
  } = props;
  const [pendingSpecialization, setPendingSpecialization] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!isPending) setPendingSpecialization(null);
  }, [isPending]);

  // Caps as the room left above each stat, which the preset split fills
  const { schema: statSchema, maxValues } = createAssignedExperienceSchema(userData);
  const defaultValues = statSchema.parse({});

  // Combat presets split points across four stats; mastery presets target one discipline.
  const specializationOptions = [
    {
      id: "mind",
      name: "Mind",
      image: IMG_TRAIN_INTELLIGENCE,
      description: "Willpower and intelligence",
      stats: ["willpower", "intelligence", "offence", "defence"] as const,
    },
    {
      id: "body",
      name: "Body",
      image: IMG_TRAIN_STRENGTH,
      description: "Strength and speed",
      stats: ["strength", "speed", "offence", "defence"] as const,
    },
    {
      id: "resolve",
      name: "Resolve",
      image: IMG_TRAIN_WILLPOWER,
      description: "Willpower and speed",
      stats: ["willpower", "speed", "offence", "defence"] as const,
    },
    {
      id: "tactics",
      name: "Tactics",
      image: IMG_TRAIN_SPEED,
      description: "Intelligence and speed",
      stats: ["intelligence", "speed", "offence", "defence"] as const,
    },
    ...(includeMasteries
      ? [
          {
            id: "ninjutsuMastery",
            name: "Ninjutsu Mastery",
            image: IMG_TRAIN_NIN_OFF,
            description: "Unlock Ninjutsu content",
            stats: ["ninjutsuMastery"] as const,
          },
          {
            id: "genjutsuMastery",
            name: "Genjutsu Mastery",
            image: IMG_TRAIN_GEN_OFF,
            description: "Unlock Genjutsu content",
            stats: ["genjutsuMastery"] as const,
          },
          {
            id: "taijutsuMastery",
            name: "Taijutsu Mastery",
            image: IMG_TRAIN_TAI_OFF,
            description: "Unlock Taijutsu content",
            stats: ["taijutsuMastery"] as const,
          },
          {
            id: "bukijutsuMastery",
            name: "Bukijutsu Mastery",
            image: IMG_TRAIN_BUKI_OFF,
            description: "Unlock Bukijutsu content",
            stats: ["bukijutsuMastery"] as const,
          },
          ...BasicElementName.map((element) => ({
            id: element,
            name: `${element} Mastery`,
            image: getElementImg(element),
            description: providedElements(userData).includes(element)
              ? "Provided by innate elements or bloodline"
              : `Unlock ${element}`,
            stats: [element],
          })),
        ]
      : []),
  ];

  // Every default is 0 and every stat has a numeric cap, so a stat is capped when no room is left.
  const isCapped = (stat: (typeof specializationOptions)[number]["stats"][number]) =>
    maxValues[stat] <= 0;

  /**
   * Points this preset adds per stat: an even split, with whatever a capped stat cannot take
   * spilled onto the stats that still have room. The confirm dialog renders this same result,
   * so the preview always matches what gets applied.
   */
  const getSpecializationSplit = (
    option: (typeof specializationOptions)[number],
  ): Record<string, number> => {
    const pointsPerStat = Math.floor(availableStats / option.stats.length);
    const leftoverPoints = availableStats - pointsPerStat * option.stats.length;
    const added: Record<string, number> = {};
    let unusedPoints = 0;
    option.stats.forEach((stat, index) => {
      const room = Math.floor(maxValues[stat] ?? 0);
      const wanted = pointsPerStat + (index < leftoverPoints ? 1 : 0);
      const add = Math.min(room, wanted);
      unusedPoints += wanted - add;
      added[stat] = add;
    });
    for (const stat of option.stats) {
      if (unusedPoints <= 0) break;
      const room = Math.floor(maxValues[stat] ?? 0) - (added[stat] ?? 0);
      const add = Math.min(room, unusedPoints);
      added[stat] = (added[stat] ?? 0) + add;
      unusedPoints -= add;
    }
    return added;
  };

  const handleSpecializationSelect = (
    option: (typeof specializationOptions)[number],
  ) => {
    setPendingSpecialization(option.id);
    onAccept({ ...defaultValues, ...getSpecializationSplit(option) });
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4" aria-busy={isPending}>
      {specializationOptions.map((option) => {
        const cappedStats = option.stats.filter(isCapped);
        // Disabled only when every stat is capped: all combat presets share offence/defence.
        const isDisabled =
          (isInArray(option.id, BasicElementName) &&
            !canAttemptAwakeAction(userData)) ||
          cappedStats.length === option.stats.length;
        const isAssigning = pendingSpecialization === option.id;
        const split = getSpecializationSplit(option);
        const placed = round(Object.values(split).reduce((a, b) => a + b, 0));
        const isCapLimited = placed < round(availableStats);

        return (
          <Confirm
            id="tutorial-specialization-confirm"
            key={option.id}
            title={`Confirm ${option.name} Specialization`}
            disabled={isDisabled || isPending || pendingSpecialization !== null}
            button={
              <div
                className={`flex flex-col items-center ${isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:opacity-70"}`}
              >
                <Image
                  src={option.image}
                  alt={option.name}
                  width={128}
                  height={128}
                  className="w-full rounded-lg"
                  priority={true}
                />
                <p className="mt-2 text-center font-bold text-sm">{option.name}</p>
                {isAssigning ? (
                  <p
                    className="mt-1 inline-flex items-center text-center font-semibold text-xs"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2
                      className="mr-1 h-3.5 w-3.5 animate-spin"
                      aria-hidden="true"
                    />
                    {pendingLabel}
                  </p>
                ) : (
                  <p className="mt-1 text-center text-muted-foreground text-xs">
                    {option.description}
                  </p>
                )}
                {isDisabled && (
                  <p className="mt-1 text-center font-semibold text-red-500 text-xs">
                    {isInArray(option.id, BasicElementName)
                      ? !canAttemptAwakeAction(userData)
                        ? "Must be awake"
                        : providedElements(userData).includes(option.id)
                          ? "Already provided"
                          : "Fully mastered"
                      : "Stats maxed"}
                  </p>
                )}
              </div>
            }
            onAccept={() => handleSpecializationSelect(option)}
          >
            <div>
              <p className="mb-2">
                {isCapLimited
                  ? `This will distribute ${placed.toLocaleString()} of ${availableStats.toLocaleString()} stat points across:`
                  : `This will distribute ${availableStats.toLocaleString()} stat points across:`}
              </p>
              <ul className="mb-2 list-inside list-disc">
                {option.stats.map((stat, index) => {
                  const isCapped = cappedStats.includes(stat);
                  const points = split[stat] ?? 0;
                  return (
                    <li
                      key={`${stat}-${index}`}
                      className={`capitalize ${isCapped ? "font-semibold text-red-500" : ""}`}
                    >
                      {capitalizeFirstLetter(noCase(stat))} (+
                      {points.toLocaleString()}){isCapped && " (currently maxed)"}
                    </li>
                  );
                })}
              </ul>
              {isCapLimited && (
                <p>
                  Caps leave the other {round(availableStats - placed).toLocaleString()}{" "}
                  points unassigned.
                </p>
              )}
            </div>
          </Confirm>
        );
      })}
      <p className="col-span-2 mt-2 text-center text-muted-foreground text-xs sm:col-span-4">
        {includeMasteries
          ? "Use Advanced to split points across multiple stats, masteries and elements."
          : "Use Advanced to choose how many points go into each stat."}
      </p>
    </div>
  );
};

interface AdvancedDistributionProps {
  userData: NonNullable<UserWithRelations>;
  availableStats: number;
  onAccept: StatDistributionProps["onAccept"];
  includeMasteries?: boolean;
  forceUseAll?: boolean;
  isRedistribution?: boolean;
  isPending?: boolean;
  pendingLabel?: string;
}

/** Per-stat slider allocation; the only form for redistribution. */
const AdvancedDistribution: React.FC<AdvancedDistributionProps> = (props) => {
  const {
    includeMasteries = false,
    forceUseAll,
    isRedistribution,
    userData,
    availableStats,
    onAccept,
    isPending = false,
    pendingLabel = "Assigning",
  } = props;

  // State - synchronize with localStorage using useLocalStorage hook
  const [useInputBoxes, setUseInputBoxes] = useLocalStorage<boolean>(
    "statsDistributionUseInputBoxes",
    false,
  );

  // Stats Schema: redistribution works in absolute rank caps, assignment in remaining room.
  // Only a copy is capped, so the cached user keeps its stored values.
  const cappedUser = withCappedStats(userData);
  const { schema: statSchema, maxValues: caps } = includeMasteries
    ? createAssignedExperienceSchema(userData)
    : createStatSchema(
        isRedistribution ? 10 : 0,
        isRedistribution ? 10 : 0,
        isRedistribution ? { rank: userData.rank } : cappedUser,
      );
  const defaultValues: Partial<
    z.output<ReturnType<typeof createAssignedExperienceSchema>["schema"]>
  > = statSchema.parse(isRedistribution ? cappedUser : {});
  const maxValues: Partial<Record<keyof typeof defaultValues, number>> = caps;
  const statNames = Object.keys(defaultValues) as (keyof typeof defaultValues)[];

  // Form setup
  const form = useForm<
    z.input<ReturnType<typeof createAssignedExperienceSchema>["schema"]>,
    unknown,
    AssignableUserStats
  >({
    defaultValues,
    mode: "all",
    resolver: zodResolver(statSchema),
  });
  const formValues = useWatch({ control: form.control });
  const formSum = sumStatValues(formValues);

  // Is the form the same as the default values
  const isDefault = Object.keys(formValues).every((key) => {
    return (
      formValues[key as keyof typeof formValues] ===
      defaultValues[key as keyof typeof defaultValues]
    );
  });

  // Derived data
  const misalignment = round(formSum - availableStats);

  // Figure out what to show on button, and whether it is disabled or not
  let buttonText = `Assign points`;
  if (misalignment > 0) {
    buttonText = `Remove ${misalignment.toLocaleString()} points`;
  } else if (forceUseAll && misalignment < 0) {
    buttonText = `Place ${(-misalignment).toLocaleString()} more points`;
  } else if (isDefault) {
    buttonText = "Nothing changed";
  } else if (
    !canAttemptAwakeAction(userData) &&
    BasicElementName.some((element) => Number(formValues[element]) >= 1)
  ) {
    buttonText = "Must be awake to assign elemental XP";
  }
  const isDisabled =
    buttonText !== "Assign points" ||
    Object.values(formValues).some((value) => !Number.isFinite(Number(value)));

  // Submit handler
  const onSubmit = form.handleSubmit(async (data) => {
    if (isDisabled || isPending) return;
    if ((await onAccept(data)) === true) form.reset(defaultValues);
  });

  // Show component
  return (
    <Form {...form}>
      <div className="mb-4 flex items-center justify-end gap-2">
        <Label htmlFor="input-toggle" className="text-sm">
          Use input boxes
        </Label>
        <Switch
          id="input-toggle"
          checked={useInputBoxes}
          onCheckedChange={setUseInputBoxes}
          disabled={isPending}
        />
      </div>
      <form
        className="grid grid-cols-2 gap-2"
        onSubmit={onSubmit}
        aria-busy={isPending}
      >
        {statNames.map((stat, i) => {
          const maxValue = maxValues[stat];
          const minValue = 0;
          const step = isInArray(stat, BasicElementName) ? 1 : 0.01;
          const hasFiniteValue = Number.isFinite(Number(formValues[stat]));
          const currentValue = hasFiniteValue ? Number(formValues[stat]) : 0;
          const useInput = useInputBoxes || !hasFiniteValue;

          // Calculate remaining points and dynamic max for this slider
          // remainingPoints already includes currentValue freed up from the total
          const remainingPoints = availableStats - formSum + currentValue;
          const dynamicMax = Math.min(maxValue ?? Infinity, remainingPoints);

          // Keep stale or invalid drafts editable after a cap or eligibility refresh.
          if ((maxValue ?? 0) > 0 || Number(formValues[stat]) !== 0) {
            return (
              <FormField
                key={`${stat}-${i}`}
                control={form.control}
                name={stat}
                render={({ field, fieldState }) => (
                  <FormItem className="pt-1">
                    {useInput && (
                      <FormLabel>
                        {capitalizeFirstLetter(noCase(stat))}
                        {currentValue
                          ? ` - Selected: ${Number(currentValue.toFixed(2)).toLocaleString()} / ${Number(availableStats.toFixed(2)).toLocaleString()}`
                          : ""}
                      </FormLabel>
                    )}
                    {useInput ? (
                      <FormControl>
                        <NumberInput
                          min={minValue}
                          max={dynamicMax}
                          step={step}
                          value={(field.value as number) ?? 0}
                          // Retain numeric range failures for schema and budget feedback.
                          onChange={(event) =>
                            field.onChange(
                              event.currentTarget.validity.stepMismatch
                                ? Number.NaN
                                : event.currentTarget.valueAsNumber,
                            )
                          }
                          onBlur={field.onBlur}
                          name={field.name}
                          className="w-full"
                          disabled={isPending}
                        />
                      </FormControl>
                    ) : (
                      <SliderField
                        id={stat}
                        label={capitalizeFirstLetter(noCase(stat))}
                        default={defaultValues[stat] ?? 0}
                        min={minValue}
                        // Native ranges must represent a retained draft so it can be lowered.
                        max={Math.max(dynamicMax, currentValue)}
                        step={step}
                        watchedValue={currentValue}
                        watchedTotal={availableStats}
                        setValue={form.setValue}
                        register={form.register}
                        error={fieldState.error?.message}
                        preventDebounce={true}
                        disabled={isPending}
                      />
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            );
          } else {
            return (
              <FormItem className="pt-1" key={`${stat}-${i}`}>
                <FormLabel>{capitalizeFirstLetter(stat)}</FormLabel>
                <FormControl>
                  <div className="text-muted-foreground text-sm">
                    {isInArray(stat, BasicElementName)
                      ? providedElements(userData).includes(stat)
                        ? "Provided by innate elements or bloodline"
                        : "Fully mastered"
                      : `- Max for ${capitalizeFirstLetter(userData.rank)}`}
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            );
          }
        })}
        <Button
          id="create"
          className="col-span-2 my-1 w-full"
          type="submit"
          disabled={isDisabled || isPending}
          aria-busy={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              <span role="status" aria-live="polite">
                {pendingLabel}
              </span>
            </>
          ) : (
            buttonText
          )}
        </Button>
      </form>
    </Form>
  );
};

export default DistributeStatsForm;

/** Total of the numeric entries in a stat allocation; blank or invalid inputs count as 0. */
const sumStatValues = (values: Record<string, unknown>) =>
  Object.values(values)
    .map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
    .reduce((a, b) => a + b, 0);
