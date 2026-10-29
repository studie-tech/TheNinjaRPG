"use client";

import { useId } from "react";
import { type Control, Controller, type FieldValues, type Path } from "react-hook-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { lpcColors, lpcEquipmentProfiles } from "@/validators/lpc";

/**
 * Share nullable silhouette/palette overrides between item and variant editors.
 * AUTO stores null; the owning form's fieldset supplies the save/measurement lock.
 */
export const LpcEquipmentFields = <
  T extends FieldValues,
  Context,
  Output extends FieldValues,
>({
  control,
}: {
  control: Control<T, Context, Output>;
}) => {
  const id = useId();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Controller
        control={control}
        name={"lpcProfile" as Path<T>}
        render={({ field, fieldState }) => (
          <div>
            <label htmlFor={`${id}-profile`} className="text-sm font-medium">
              Character equipment appearance
            </label>
            <Select
              value={
                typeof field.value === "string" && field.value ? field.value : "AUTO"
              }
              onValueChange={(value) => field.onChange(value === "AUTO" ? null : value)}
            >
              <SelectTrigger id={`${id}-profile`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {lpcEquipmentProfiles.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === "AUTO"
                      ? "Automatic content mapping"
                      : value === "NONE"
                        ? "Hidden on character"
                        : value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldState.error && (
              <p role="alert" className="text-destructive text-sm">
                {fieldState.error.message}
              </p>
            )}
          </div>
        )}
      />
      <Controller
        control={control}
        name={"lpcColor" as Path<T>}
        render={({ field, fieldState }) => (
          <div>
            <label htmlFor={`${id}-color`} className="text-sm font-medium">
              Equipment colour
            </label>
            <Select
              value={
                typeof field.value === "string" && field.value ? field.value : "AUTO"
              }
              onValueChange={(value) => field.onChange(value === "AUTO" ? null : value)}
            >
              <SelectTrigger id={`${id}-color`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="AUTO">Automatic content mapping</SelectItem>
                {lpcColors.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldState.error && (
              <p role="alert" className="text-destructive text-sm">
                {fieldState.error.message}
              </p>
            )}
          </div>
        )}
      />
    </div>
  );
};
