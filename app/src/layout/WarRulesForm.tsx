"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useFormState } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
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
import { NumberInput } from "@/components/ui/number-input";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { defaultWarRules, warRulesSchema } from "@/validators/war";

/** Edit staff settings for future approvals; active wars retain their saved rules. */
export const WarRulesForm = () => {
  const [message, setMessage] = useState("");
  const { data, isPending, isFetching, refetch } = api.war.getRules.useQuery();
  const utils = api.useUtils();
  const form = useForm<
    z.input<typeof warRulesSchema>,
    unknown,
    z.output<typeof warRulesSchema>
  >({
    defaultValues: defaultWarRules,
    values: data,
    resetOptions: { keepDirtyValues: true, keepDirty: true },
    resolver: zodResolver(warRulesSchema),
  });
  const { isDirty } = useFormState({ control: form.control });
  const mutation = api.war.setRules.useMutation({
    onSuccess: (result, values) => {
      setMessage(result.message);
      showMutationToast(result);
      if (result.success) {
        form.reset(values, { keepDirtyValues: false, keepDirty: false });
        void utils.war.getRules.invalidate();
      }
    },
    onError: (error) => setMessage(error.message),
  });
  return (
    <section className="space-y-3">
      <h3 className="font-semibold text-lg">Village war settings</h3>
      <p className="mb-3 text-muted-foreground text-sm">
        Rules are frozen when elders approve a declaration. Existing wars keep their
        rules.
      </p>
      {isPending ? (
        <Loader explanation="Loading village war settings" />
      ) : !data ? (
        <div role="alert" className="space-y-2">
          <p>Could not load village war settings.</p>
          <Button onClick={() => void refetch()} disabled={isFetching}>
            Try again
          </Button>
        </div>
      ) : (
        <Form {...form}>
          <form
            className="space-y-3"
            onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
          >
            <fieldset disabled={mutation.isPending} className="space-y-4">
              <FormField
                control={form.control}
                name="enabled"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0">
                    <FormControl>
                      <Checkbox
                        ref={field.ref}
                        name={field.name}
                        onBlur={field.onBlur}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormLabel>Enable objective village wars</FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {WAR_RULE_GROUPS.map((group) => (
                <div key={group.label} className="space-y-2">
                  <h4 className="font-semibold text-sm">{group.label}</h4>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {group.fields.map(({ name, label }) => (
                      <FormField
                        key={name}
                        control={form.control}
                        name={name}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs">{label}</FormLabel>
                            <FormControl>
                              <NumberInput
                                {...field}
                                min={warRulesSchema.shape[name].minValue ?? undefined}
                                max={warRulesSchema.shape[name].maxValue ?? undefined}
                                onValueChange={field.onChange}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                  </div>
                </div>
              ))}
              {message && (
                <p role="status" className="text-sm">
                  {message}
                </p>
              )}
              <Button disabled={mutation.isPending || !isDirty} type="submit">
                {mutation.isPending ? "Saving..." : "Save war settings"}
              </Button>
            </fieldset>
          </form>
        </Form>
      )}
    </section>
  );
};

const WAR_RULE_GROUPS = [
  {
    label: "General rules",
    fields: [
      { name: "townhallHp", label: "Town hall HP" },
      { name: "shrineHp", label: "Shrine HP" },
      { name: "declarationCost", label: "Declaration cost (tokens)" },
      { name: "noticeHours", label: "Notice period (hours)" },
      { name: "durationDays", label: "War duration (days)" },
      { name: "dailyDecay", label: "Daily town hall HP decay" },
      { name: "guardianDamage", label: "Guardian victory damage" },
      { name: "objectiveDamage", label: "Objective capture damage" },
      { name: "campDamage", label: "Camp victory damage" },
    ],
  },
  {
    label: "Role damage and recovery",
    fields: [
      { name: "regularDamage", label: "Regular damage" },
      { name: "regularRecovery", label: "Regular recovery" },
      { name: "anbuDamage", label: "ANBU damage" },
      { name: "anbuRecovery", label: "ANBU recovery" },
      { name: "assassinDamage", label: "Assassin damage" },
      { name: "assassinRecovery", label: "Assassin recovery" },
      { name: "elderDamage", label: "Elder damage" },
      { name: "elderRecovery", label: "Elder recovery" },
      { name: "coleaderDamage", label: "Co-leader damage" },
      { name: "coleaderRecovery", label: "Co-leader recovery" },
      { name: "leaderDamage", label: "Leader damage" },
      { name: "leaderRecovery", label: "Leader recovery" },
    ],
  },
] as const;
