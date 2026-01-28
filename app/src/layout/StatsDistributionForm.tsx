"use client";

import { capUserStats } from "@/libs/profile";
import React, { useState } from "react";
import Image from "@/layout/Image";
import {
  Form,
  FormControl,
  FormLabel,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import Confirm2 from "@/layout/Confirm2";
import { Button } from "@/components/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalStorage } from "@/hooks/localstorage";
import { useForm, useWatch } from "react-hook-form";
import { showMutationToast } from "@/libs/toast";
import { useTutorialStep } from "@/hooks/tutorial";
import { round } from "@/utils/math";
import { createStatSchema, type StatSchemaType } from "@/validators/combat";
import type { UserWithRelations } from "@/routers/profile";
import { capitalizeFirstLetter } from "@/utils/sanitize";
import SliderField from "@/layout/SliderField";
import NavTabs from "@/layout/NavTabs";
import ContentBox from "@/layout/ContentBox";
import { noCase } from "change-case";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  IMG_TRAIN_NIN_OFF,
  IMG_TRAIN_GEN_OFF,
  IMG_TRAIN_TAI_OFF,
  IMG_TRAIN_BUKI_OFF,
} from "@/drizzle/constants";

interface StatDistributionProps {
  id?: string;
  userData: NonNullable<UserWithRelations>;
  availableStats: number;
  onAccept: (data: StatSchemaType) => void;
  forceUseAll?: boolean;
  isRedistribution?: boolean;
  showWrapper?: boolean;
  title?: string;
  subtitle?: string;
  defaultBackHref?: string;
}

const DistributeStatsForm: React.FC<StatDistributionProps> = (props) => {
  // Destructure
  const {
    id,
    forceUseAll,
    isRedistribution,
    userData,
    availableStats,
    onAccept,
    showWrapper = true,
    title = "Distribute Stats",
    subtitle,
    defaultBackHref,
  } = props;

  // Tab state - force Advanced mode for redistribution
  const [tab, setTab] = useState<"Simple" | "Advanced">(
    isRedistribution ? "Advanced" : "Simple",
  );

  // Tutorial hook
  const { currentStep, handleNextStep } = useTutorialStep();

  // Wrapper function to handle tutorial logic before calling onAccept
  const handleAcceptWithTutorial = (data: StatSchemaType) => {
    if (currentStep?.title === "Assigning Stats") {
      const formSum = Object.values(data)
        .map((v) => Number(v))
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
    <NavTabs
      id="stats-distribution-tab"
      current={tab}
      options={["Simple", "Advanced"] as const}
      onChange={(value) => setTab(value as "Simple" | "Advanced")}
    />
  ) : null;

  // Content to render
  const content = (
    <>
      {!showWrapper && navTabs && (
        <div className="flex justify-end mb-2">{navTabs}</div>
      )}
      {tab === "Simple" && !isRedistribution ? (
        <SimpleDistribution
          userData={userData}
          availableStats={availableStats}
          onAccept={handleAcceptWithTutorial}
          isRedistribution={isRedistribution}
        />
      ) : (
        <AdvancedDistribution
          userData={userData}
          availableStats={availableStats}
          onAccept={handleAcceptWithTutorial}
          forceUseAll={forceUseAll}
          isRedistribution={isRedistribution}
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
  userData: NonNullable<UserWithRelations>;
  availableStats: number;
  onAccept: (data: StatSchemaType) => void;
  isRedistribution?: boolean;
}

const SimpleDistribution: React.FC<SimpleDistributionProps> = (props) => {
  const { userData, availableStats, onAccept, isRedistribution } = props;

  // Create stat schema to get caps
  const statSchema = createStatSchema(
    isRedistribution ? 10 : 0,
    isRedistribution ? 10 : 0,
    isRedistribution ? undefined : userData,
  );
  const defaultValues = statSchema.parse(isRedistribution ? userData : {});

  const specializationOptions = [
    {
      id: "ninjutsu",
      name: "Ninjutsu",
      image: IMG_TRAIN_NIN_OFF,
      description: "Master chakra manipulation",
      stats: [
        "willpower",
        "intelligence",
        "ninjutsuOffence",
        "ninjutsuDefence",
      ] as const,
    },
    {
      id: "taijutsu",
      name: "Taijutsu",
      image: IMG_TRAIN_TAI_OFF,
      description: "Master of martial arts",
      stats: ["strength", "speed", "taijutsuOffence", "taijutsuDefence"] as const,
    },
    {
      id: "genjutsu",
      name: "Genjutsu",
      image: IMG_TRAIN_GEN_OFF,
      description: "Master of illusions",
      stats: ["willpower", "speed", "genjutsuOffence", "genjutsuDefence"] as const,
    },
    {
      id: "bukijutsu",
      name: "Bukijutsu",
      image: IMG_TRAIN_BUKI_OFF,
      description: "Weapons mastery",
      stats: ["intelligence", "speed", "bukijutsuOffence", "bukijutsuDefence"] as const,
    },
  ];

  // Check if any stat in the specialization is capped
  const isSpecializationDisabled = (option: (typeof specializationOptions)[number]) => {
    return option.stats.some((stat) => {
      const maxValue = statSchema.shape[stat]._def.innerType._def.schema.maxValue;
      const currentValue = defaultValues[stat] ?? 0;
      return maxValue !== undefined && maxValue !== null && currentValue >= maxValue;
    });
  };

  // Get which stats are capped for display purposes
  const getCappedStats = (option: (typeof specializationOptions)[number]) => {
    return option.stats.filter((stat) => {
      const maxValue = statSchema.shape[stat]._def.innerType._def.schema.maxValue;
      const currentValue = defaultValues[stat] ?? 0;
      return maxValue !== undefined && maxValue !== null && currentValue >= maxValue;
    });
  };

  const handleSpecializationSelect = (
    option: (typeof specializationOptions)[number],
  ) => {
    // Build the stat distribution object
    const distribution: Partial<StatSchemaType> = { ...defaultValues };

    // Calculate 25% of available stats for each stat (4 stats total)
    const pointsPerStat = Math.floor(availableStats / 4);
    const leftoverPoints = availableStats - pointsPerStat * 4;

    option.stats.forEach((stat, index) => {
      // Add base points to each stat
      const basePoints = pointsPerStat;
      // Add 1 extra point to the first N stats where N is the number of leftover points
      const extraPoint = index < leftoverPoints ? 1 : 0;
      distribution[stat] = (defaultValues[stat] ?? 0) + basePoints + extraPoint;
    });

    onAccept(distribution as StatSchemaType);
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4">
      {specializationOptions.map((option) => {
        const isDisabled = isSpecializationDisabled(option);
        const cappedStats = getCappedStats(option);

        return (
          <Confirm2
            id="tutorial-specialization-confirm"
            key={option.id}
            title={`Confirm ${option.name} Specialization`}
            disabled={isDisabled}
            button={
              <div
                className={`flex flex-col items-center ${
                  isDisabled
                    ? "opacity-50 cursor-not-allowed"
                    : "cursor-pointer hover:opacity-70"
                }`}
              >
                <Image
                  src={option.image}
                  alt={option.name}
                  width={128}
                  height={128}
                  className="rounded-lg w-full"
                  priority={true}
                />
                <p className="font-bold text-sm text-center mt-2">{option.name}</p>
                <p className="text-xs text-center text-muted-foreground mt-1">
                  {option.description}
                </p>
                {isDisabled && (
                  <p className="text-xs text-center text-red-500 mt-1 font-semibold">
                    Stats maxed
                  </p>
                )}
              </div>
            }
            onAccept={() => handleSpecializationSelect(option)}
          >
            <div>
              <p className="mb-2">
                This will distribute {availableStats.toLocaleString()} stat points
                across:
              </p>
              <ul className="list-disc list-inside mb-2">
                {option.stats.map((stat, index) => {
                  const isCapped = cappedStats.includes(stat);
                  const pointsPerStat = Math.floor(availableStats / 4);
                  const leftoverPoints = availableStats - pointsPerStat * 4;
                  const points = pointsPerStat + (index < leftoverPoints ? 1 : 0);
                  return (
                    <li
                      key={stat}
                      className={`capitalize ${isCapped ? "text-red-500 font-semibold" : ""}`}
                    >
                      {capitalizeFirstLetter(noCase(stat))} (+{points})
                      {isCapped && " (currently maxed)"}
                    </li>
                  );
                })}
              </ul>
            </div>
          </Confirm2>
        );
      })}
    </div>
  );
};

/**
 * Advanced Distribution Component - Original slider-based stat distribution
 */
interface AdvancedDistributionProps {
  userData: NonNullable<UserWithRelations>;
  availableStats: number;
  onAccept: (data: StatSchemaType) => void;
  forceUseAll?: boolean;
  isRedistribution?: boolean;
}

const AdvancedDistribution: React.FC<AdvancedDistributionProps> = (props) => {
  const { forceUseAll, isRedistribution, userData, availableStats, onAccept } = props;

  // State - synchronize with localStorage using useLocalStorage hook
  const [useInputBoxes, setUseInputBoxes] = useLocalStorage<boolean>(
    "statsDistributionUseInputBoxes",
    false,
  );

  if (userData) capUserStats(userData);

  // Stats Schema
  const statSchema = createStatSchema(
    isRedistribution ? 10 : 0,
    isRedistribution ? 10 : 0,
    isRedistribution ? undefined : userData,
  );
  const defaultValues = statSchema.parse(isRedistribution ? userData : {});
  const statNames = Object.keys(defaultValues) as (keyof typeof defaultValues)[];

  // Form setup
  const form = useForm<StatSchemaType>({
    defaultValues,
    mode: "all",
    resolver: zodResolver(statSchema),
  });
  const formValues = useWatch({ control: form.control });
  const formSum = Object.values(formValues)
    .map((v) => Number(v))
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
  const isDisabled = buttonText !== "Assign points";

  // Submit handler
  const onSubmit = form.handleSubmit((data) => {
    onAccept(data);
  });

  // Show component
  return (
    <Form {...form}>
      <div className="flex items-center justify-end gap-2 mb-4">
        <Label htmlFor="input-toggle" className="text-sm">
          Use input boxes
        </Label>
        <Switch
          id="input-toggle"
          checked={useInputBoxes}
          onCheckedChange={setUseInputBoxes}
        />
      </div>
      <form className="grid grid-cols-2 gap-2" onSubmit={onSubmit}>
        {statNames.map((stat, i) => {
          const maxValue = statSchema.shape[stat]._def.innerType._def.schema.maxValue;
          const minValue =
            statSchema.shape[stat]._def.innerType._def.schema.minValue ?? 0;
          const currentValue = Number(formValues[stat] ?? 0);

          // Calculate remaining points and dynamic max for this slider
          // remainingPoints already includes currentValue freed up from the total
          const remainingPoints = availableStats - formSum + currentValue;
          const dynamicMax = Math.min(maxValue ?? Infinity, remainingPoints);

          if (maxValue && maxValue > 0) {
            return (
              <FormField
                key={i}
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
                        <Input
                          type="number"
                          min={minValue}
                          max={dynamicMax}
                          step={0.01}
                          value={field.value ?? 0}
                          onChange={(e) => {
                            const value = parseFloat(e.target.value) || 0;
                            const clampedValue = Math.max(
                              minValue,
                              Math.min(dynamicMax, value),
                            );
                            field.onChange(clampedValue);
                          }}
                          onBlur={field.onBlur}
                          name={field.name}
                          className="w-full"
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
                      />
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            );
          } else {
            return (
              <FormItem className="pt-1" key={i}>
                <FormLabel>{capitalizeFirstLetter(stat)}</FormLabel>
                <FormControl>
                  <div className="text-sm text-muted-foreground">
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
          className="w-full col-span-2 my-1"
          type="submit"
          disabled={isDisabled}
        >
          {buttonText}
        </Button>
      </form>
    </Form>
  );
};

export default DistributeStatsForm;
