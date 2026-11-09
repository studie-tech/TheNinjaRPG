"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Sun, Swords } from "lucide-react";
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
import { NumberInput } from "@/components/ui/number-input";
import { TRAINING_ARENA_DUMMY_ID } from "@/drizzle/constants";
import { useAutoCombatSetting } from "@/hooks/combat";
import { useSleepToggle } from "@/hooks/sleep";
import { useStartArenaBattle } from "@/hooks/useStartArenaBattle";
import { BattleSetupPanel } from "@/layout/battlearena/BattleSetupPanel";
import Loader from "@/layout/Loader";
import {
  type DummyPreset,
  dummyPresetValues,
  matchDummyPreset,
} from "@/libs/battleArena";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { capitalizeFirstLetter } from "@/utils/string";
import { useRequiredUserData } from "@/utils/UserContext";
import type { StatSchemaType } from "@/validators/combat";
import { createStatSchema } from "@/validators/combat";

/** Training: fight an unbeatable dummy whose stats you choose, with quick presets. */
export function TrainingMode({
  statDistribution,
  setStatDistribution,
}: TrainingModeProps) {
  const { data: userData } = useRequiredUserData();
  const { toggleSleep, isTogglingSleep } = useSleepToggle();
  const [autoCombat] = useAutoCombatSetting();

  const { start, isAttacking } = useStartArenaBattle((result) =>
    showMutationToast({ ...result, message: "Entering the Training" }),
  );

  const { schema: statSchema, maxValues } = createStatSchema(
    MIN_STAT,
    MIN_STAT,
    undefined,
  );
  const form = useForm<z.input<typeof statSchema>, unknown, StatSchemaType>({
    defaultValues: statSchema.parse(statDistribution ?? {}) as z.input<
      typeof statSchema
    >,
    mode: "all",
    resolver: zodResolver(statSchema),
  });
  const values = useWatch({ control: form.control });

  const submit = (data: StatSchemaType) => {
    if (start({ aiId: TRAINING_ARENA_DUMMY_ID, stats: data, autoCombat }))
      setStatDistribution(data);
  };

  if (!userData) return <Loader explanation="Loading userdata" />;

  const isAsleep = userData.status === "ASLEEP" && userData.autoWakeUp === false;
  const statNames = (Object.keys(maxValues) as (keyof typeof maxValues)[]).filter(
    // The dummy never attacks, so it has no offence to set.
    (stat) => stat !== "offence",
  );
  const preset = matchDummyPreset(
    values as Record<string, number>,
    userData,
    maxValues,
    MIN_STAT,
  );
  const applyPreset = (next: Exclude<DummyPreset, "Custom">) => {
    const presetValues = dummyPresetValues(next, userData, maxValues, MIN_STAT);
    for (const [stat, value] of Object.entries(presetValues)) {
      form.setValue(stat as keyof typeof presetValues, value, { shouldValidate: true });
    }
  };

  const action = isAsleep ? (
    isTogglingSleep ? (
      <Loader explanation="Waking" />
    ) : (
      <Button
        type="button"
        size="xl"
        decoration="gold"
        animation="pulse"
        className="w-full text-2xl italic"
        onClick={() => toggleSleep()}
      >
        <Sun className="mr-4 h-10 w-10" />
        Wake up!
      </Button>
    )
  ) : (
    <Button
      type="submit"
      form="training-dummy-stats"
      size="xl"
      decoration="gold"
      animation="pulse"
      className="w-full text-xl italic"
      disabled={isAttacking}
      aria-live="polite"
    >
      {isAttacking ? (
        <Loader2 className="mr-3 h-8 w-8 animate-spin" aria-hidden />
      ) : (
        <Swords className="mr-3 h-8 w-8" aria-hidden />
      )}
      {isAttacking ? "Starting" : "Start training"}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3 @min-[600px]:flex-row">
      <section
        aria-label="Dummy stats"
        className="bg-card flex min-w-0 flex-1 flex-col gap-3 rounded-xl border p-3"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-base font-bold">Dummy stats</h2>
          <span className="text-muted-foreground text-xs">Kept for next time</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={preset === option}
              disabled={option === "Custom"}
              onClick={() => option !== "Custom" && applyPreset(option)}
              className={cn(
                "h-9 rounded-full border px-3 text-xs font-semibold",
                preset === option
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted disabled:opacity-60",
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <Form {...form}>
          <form
            id="training-dummy-stats"
            aria-busy={isAttacking}
            className="flex flex-col gap-3"
            onSubmit={(event) => void form.handleSubmit(submit)(event)}
          >
            <fieldset disabled={isAttacking} className="contents">
              {statNames.map((stat) => {
                const max = maxValues[stat];
                const current = Number(values[stat]) || 0;
                return (
                  <FormField
                    key={stat}
                    control={form.control}
                    name={stat}
                    render={({ field }) => (
                      <FormItem className="grid grid-cols-[6.5rem_minmax(0,1fr)_6rem] items-center gap-3 space-y-0">
                        <FormLabel>{capitalizeFirstLetter(stat)}</FormLabel>
                        <div aria-hidden className="bg-muted h-1.5 rounded-full">
                          <div
                            className="bg-primary h-1.5 rounded-full"
                            style={{
                              width: `${max ? Math.min(100, (current / max) * 100) : 0}%`,
                            }}
                          />
                        </div>
                        <FormControl>
                          <NumberInput
                            step="any"
                            // Native steppers would push the value off the right edge.
                            className="[appearance:textfield] text-right font-semibold tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            {...field}
                            value={field.value as number}
                            onValueChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage className="col-span-3" />
                      </FormItem>
                    )}
                  />
                );
              })}
            </fieldset>
          </form>
        </Form>
        <p className="text-muted-foreground text-xs">
          Each stat runs from {MIN_STAT} up to the rank cap. The dummy never attacks, so
          it has no offence.
        </p>
      </section>
      <BattleSetupPanel autoCombat action={action} />
    </div>
  );
}

const MIN_STAT = 10;
const PRESETS: DummyPreset[] = ["Minimum", "Like me", "Maximum", "Custom"];

interface TrainingModeProps {
  statDistribution: StatSchemaType | undefined;
  setStatDistribution: (newValue: StatSchemaType | undefined) => void;
}
