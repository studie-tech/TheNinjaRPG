"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { NumberInput } from "@/components/ui/number-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MAP_SECTOR_ID_MAX, MAP_SECTOR_ID_MIN } from "@/drizzle/constants";
import {
  type SectorForm,
  type SectorFormInput,
  sectorFormSchema,
} from "@/validators/travel";

/** Locate a sector on a map by ID; the caller styles the trigger for its toolbar. */
export const FindSectorPopover: React.FC<{
  focusSector: number | null;
  onFocusSector: (sector: number | null) => void;
  trigger: React.ReactNode;
  /** Let the trigger element itself be the button, when it is not just an icon. */
  triggerAsChild?: boolean;
}> = ({ focusSector, onFocusSector, trigger, triggerAsChild }) => {
  const form = useForm<SectorFormInput, unknown, SectorForm>({
    mode: "all",
    resolver: zodResolver(sectorFormSchema),
  });
  const sector = useWatch({ control: form.control, name: "sector" }) as
    | number
    | undefined;

  return (
    <Popover>
      <PopoverTrigger asChild={triggerAsChild}>{trigger}</PopoverTrigger>
      <PopoverContent>
        <p className="py-2 font-semibold">Find Sector</p>
        <p className="pb-2 text-muted-foreground text-sm">
          Enter a sector ID to locate it on the map.
        </p>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => {
              onFocusSector(data.sector);
            })}
            className="flex flex-col gap-2"
          >
            <SectorIdField control={form.control} />
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                className="flex-1"
                disabled={!Number.isFinite(sector)}
              >
                Find Sector {Number.isFinite(sector) ? sector : "..."}
              </Button>
              {focusSector !== null && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onFocusSector(null)}
                >
                  Clear
                </Button>
              )}
            </div>
          </form>
        </Form>
      </PopoverContent>
    </Popover>
  );
};

/** Sector-ID input for forms built on `sectorFormSchema`. */
export const SectorIdField: React.FC<{
  control: Control<SectorFormInput, unknown, SectorForm>;
}> = ({ control }) => (
  <FormField
    control={control}
    name="sector"
    render={({ field }) => (
      <FormItem>
        <FormControl>
          <NumberInput
            className="w-full"
            placeholder={`Sector ID (${MAP_SECTOR_ID_MIN}-${MAP_SECTOR_ID_MAX})`}
            {...field}
            value={field.value as number | undefined}
            onValueChange={field.onChange}
          />
        </FormControl>
        <FormMessage />
      </FormItem>
    )}
  />
);
