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
import Image from "@/layout/Image";
import NavTabs from "@/layout/NavTabs";
import SliderField from "@/layout/SliderField";
import { withCappedStats } from "@/libs/profile";
import { showMutationToast } from "@/libs/toast";
import type { UserWithRelations } from "@/routers/profile";
import { round } from "@/utils/math";
import { capitalizeFirstLetter } from "@/utils/string";
import {
  type AssignableUserStats,
  createStatSchema,
  type StatSchemaType,
} from "@/validators/combat";
import { createAssignedExperienceSchema } from "@/validators/user";

interface StatDistributionProps {
  id?: string;
  userData: NonNullable<UserWithRelations>;
  availableStats: number;
  onAccept: (data: AssignableUserStats) => void;
  includeMasteries?: boolean;
  forceUseAll?: boolean;
  isRedistribution?: boolean;
  showWrapper?: boolean;
  title?: string;
  subtitle?: string;
  defaultBackHref?: string;
  isPending: boolean;
  pendingLabel?: string;
}

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
  } = props;

  // Tab state - force Advanced mode for redistribution
  const [tab, setTab] = useState<"Simple" | "Advanced">(
    isRedistribution || includeMasteries ? "Advanced" : "Simple",
  );

  // Tutorial hook
  const { currentStep, handleNextStep } = useTutorialStep();

  // Wrapper function to handle tutorial logic before calling onAccept
  const handleAcceptWithTutorial = (data: AssignableUserStats) => {
    if (currentStep?.title === "Assigning Stats") {
      const formSum = Object.values(data)
        .map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
        .reduce((a, b) => a + b, 0);

      if (formSum === availableStats) {
        handleNextStep();
        onAccept(data);
      } else {
        showMutationToast({
          success: false,
          message: "You must assign all points to your stats to continue.",
        });
      }
    } else {
      onAccept(data);
    }
  };

  // NavTabs component - hide for redistribution
  const navTabs = !isRedistribution ? (
    <div
      aria-disabled={isPending}
      className={isPending ? "pointer-events-none opacity-50" : undefined}
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
    <>
      {!showWrapper && navTabs && (
        <div className="mb-2 flex justify-end">{navTabs}</div>
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
    </>
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
  onAccept: (data: AssignableUserStats) => void;
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
        ]
      : []),
  ];

  // Disable a specialization only when every one of its stats is already at cap.
  // All presets share offence/defence, so treating a single capped combat stat as
  // "maxed" would hide every Simple option.
  const isSpecializationDisabled = (option: (typeof specializationOptions)[number]) => {
    return option.stats.every((stat) => {
      const maxValue = maxValues[stat];
      const currentValue = defaultValues[stat] ?? 0;
      return maxValue !== undefined && maxValue !== null && currentValue >= maxValue;
    });
  };

  // Get which stats are capped for display purposes
  const getCappedStats = (option: (typeof specializationOptions)[number]) => {
    return option.stats.filter((stat) => {
      const maxValue = maxValues[stat];
      const currentValue = defaultValues[stat] ?? 0;
      return maxValue !== undefined && maxValue !== null && currentValue >= maxValue;
    });
  };

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
    const distribution: Partial<AssignableUserStats> = { ...defaultValues };
    const added = getSpecializationSplit(option);
    for (const stat of option.stats) {
      distribution[stat] = (defaultValues[stat] ?? 0) + (added[stat] ?? 0);
    }
    onAccept(distribution as AssignableUserStats);
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4" aria-busy={isPending}>
      {specializationOptions.map((option) => {
        const isDisabled = isSpecializationDisabled(option);
        const isAssigning = pendingSpecialization === option.id;
        const cappedStats = getCappedStats(option);
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
                    Stats maxed
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
                  Rank caps leave the other{" "}
                  {round(availableStats - placed).toLocaleString()} points unassigned.
                </p>
              )}
            </div>
          </Confirm>
        );
      })}
      <p className="col-span-2 mt-2 text-center text-muted-foreground text-xs sm:col-span-4">
        Masteries unlock content without granting level XP. Use Advanced to split points
        across multiple masteries and stats.
      </p>
    </div>
  );
};

/**
 * Advanced Distribution Component - Original slider-based stat distribution
 */
interface AdvancedDistributionProps {
  userData: NonNullable<UserWithRelations>;
  availableStats: number;
  onAccept: (data: AssignableUserStats) => void;
  includeMasteries?: boolean;
  forceUseAll?: boolean;
  isRedistribution?: boolean;
  isPending?: boolean;
  pendingLabel?: string;
}

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
  const { schema: statSchema, maxValues } = includeMasteries
    ? createAssignedExperienceSchema(userData)
    : createStatSchema(
        isRedistribution ? 10 : 0,
        isRedistribution ? 10 : 0,
        isRedistribution ? { rank: userData.rank } : cappedUser,
      );
  const defaultValues = statSchema.parse(isRedistribution ? cappedUser : {});
  const statNames = Object.keys(defaultValues) as (keyof typeof defaultValues)[];

  // Form setup
  const form = useForm<z.input<typeof statSchema>, unknown, AssignableUserStats>({
    defaultValues: defaultValues as z.input<typeof statSchema>,
    mode: "all",
    resolver: zodResolver(statSchema),
  });
  const formValues = useWatch({ control: form.control });
  const formSum = Object.values(formValues)
    .map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
    .reduce((a, b) => a + b, 0);

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
  }
  const isDisabled =
    buttonText !== "Assign points" ||
    Object.values(formValues).some((value) => !Number.isFinite(Number(value)));

  // Submit handler
  const onSubmit = form.handleSubmit((data) => {
    onAccept(data);
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
          const currentValue = Number.isFinite(Number(formValues[stat]))
            ? Number(formValues[stat])
            : 0;

          // Calculate remaining points and dynamic max for this slider
          // remainingPoints already includes currentValue freed up from the total
          const remainingPoints = availableStats - formSum + currentValue;
          const dynamicMax = Math.min(maxValue ?? Infinity, remainingPoints);

          if (maxValue && maxValue > 0) {
            return (
              <FormField
                key={`${stat}-${i}`}
                control={form.control}
                name={stat}
                render={({ field, fieldState }) => (
                  <FormItem className="pt-1">
                    {useInputBoxes && (
                      <FormLabel>
                        {capitalizeFirstLetter(noCase(stat))}
                        {currentValue
                          ? ` - Selected: ${Number(currentValue.toFixed(2)).toLocaleString()} / ${Number(availableStats.toFixed(2)).toLocaleString()}`
                          : ""}
                      </FormLabel>
                    )}
                    {useInputBoxes ? (
                      <FormControl>
                        <NumberInput
                          min={minValue}
                          max={dynamicMax}
                          step={0.01}
                          value={(field.value as number) ?? 0}
                          onValueChange={field.onChange}
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
                        max={dynamicMax}
                        step={0.01}
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
                    - Max for {capitalizeFirstLetter(userData.rank)}
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
