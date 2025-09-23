"use client";

import { capUserStats } from "@/libs/profile";
import React from "react";
import {
  Form,
  FormControl,
  FormLabel,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { round } from "@/utils/math";
import { createStatSchema, type StatSchemaType } from "@/libs/combat/types";
import type { UserWithRelations } from "@/routers/profile";
import { capitalizeFirstLetter } from "@/utils/sanitize";

interface StatDistributionProps {
  userData: NonNullable<UserWithRelations>;
  availableStats: number;
  onAccept: (data: StatSchemaType) => void;
  forceUseAll?: boolean;
  isRedistribution?: boolean;
}

const DistributeStatsForm: React.FC<StatDistributionProps> = (props) => {
  // Destructure
  const { forceUseAll, isRedistribution, userData, availableStats, onAccept } = props;

  // State
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
    buttonText = `Remove ${misalignment} points`;
  } else if (forceUseAll && misalignment < 0) {
    buttonText = `Place ${-misalignment} more points`;
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
    <>
      <Form {...form}>
        <form className="grid grid-cols-2 gap-2" onSubmit={onSubmit}>
          {statNames.map((stat, i) => {
            const maxValue = statSchema.shape[stat]._def.innerType._def.schema.maxValue;
            if (maxValue && maxValue > 0) {
              return (
                <FormField
                  key={i}
                  control={form.control}
                  name={stat}
                  render={({ field }) => (
                    <FormItem className="pt-1">
                      <FormLabel>{stat}</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder={stat} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              );
            } else {
              return (
                <FormItem className="pt-1" key={i}>
                  <FormLabel>{stat}</FormLabel>
                  <FormControl>
                    <div>- Max for {capitalizeFirstLetter(userData.rank)}</div>
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
    </>
  );
};

export default DistributeStatsForm;
