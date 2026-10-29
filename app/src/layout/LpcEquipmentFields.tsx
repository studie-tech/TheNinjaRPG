"use client";

import { useId, useState } from "react";
import {
  type Control,
  Controller,
  type FieldValues,
  type Path,
  useWatch,
} from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CharacterPreview } from "@/layout/CharacterPreview";
import {
  resolveItemSprite,
  type SpriteItem,
  type SpriteVariant,
} from "@/libs/lpc/appearance";
import { cn } from "@/libs/shadui";
import type { LpcBody } from "@/validators/lpc";
import { lpcColors, lpcEquipmentProfiles } from "@/validators/lpc";

/**
 * Preview nullable item/variant overrides through the same worn-item resolver as gameplay.
 * AUTO stores null; the owning form's fieldset supplies the save/measurement lock.
 */
export const LpcEquipmentFields = <
  T extends FieldValues,
  Context,
  Output extends FieldValues,
>({
  control,
  item,
  variant,
  className,
}: {
  control: Control<T, Context, Output>;
  item: SpriteItem;
  variant?: SpriteVariant;
  className?: string;
}) => {
  const id = useId();
  const [body, setBody] = useState<LpcBody>("male");
  const [profile, color] = useWatch({
    control,
    name: ["lpcProfile", "lpcColor"] as Path<T>[],
  });
  const overrides = {
    lpcProfile: profile || null,
    lpcColor: color || null,
  } as SpriteVariant;
  // Variant drafts inherit the saved base; base drafts replace their own saved overrides.
  const previewItem = variant ? item : { ...item, ...overrides };
  const previewVariant = variant ? { ...variant, ...overrides } : undefined;
  const visual = resolveItemSprite(previewItem, previewVariant);
  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      <div className="min-w-0 space-y-3">
        <Controller
          control={control}
          name={"lpcProfile" as Path<T>}
          render={({ field, fieldState }) => (
            <div className="grid gap-2">
              <Label htmlFor={`${id}-profile`}>Equipment appearance</Label>
              <Select
                value={
                  typeof field.value === "string" && field.value ? field.value : "AUTO"
                }
                onValueChange={(value) =>
                  field.onChange(value === "AUTO" ? null : value)
                }
              >
                <SelectTrigger id={`${id}-profile`} isDirty={fieldState.isDirty}>
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
            <div className="grid gap-2">
              <Label htmlFor={`${id}-color`}>Equipment colour</Label>
              <Select
                value={
                  typeof field.value === "string" && field.value ? field.value : "AUTO"
                }
                onValueChange={(value) =>
                  field.onChange(value === "AUTO" ? null : value)
                }
              >
                <SelectTrigger id={`${id}-color`} isDirty={fieldState.isDirty}>
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
      <div className="space-y-1 self-center">
        <CharacterPreview
          className="w-32"
          label={
            visual.profile === "NONE" ? "Hidden on character" : "Equipment preview"
          }
          user={{
            spriteBodyStyle: body,
            items: [
              {
                equipped: item.slot && item.slot !== "NONE" ? item.slot : "ITEM",
                item: previewItem,
                activeVariant: previewVariant,
              },
            ],
          }}
        />
        <fieldset className="flex justify-center gap-1" aria-label="Preview body style">
          {(["male", "female"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant="outline"
              size="sm"
              className={cn("h-7 px-2", body === value && "ring-primary ring-1")}
              aria-pressed={body === value}
              onClick={() => setBody(value)}
            >
              {value === "male" ? "Broad" : "Slender"}
            </Button>
          ))}
        </fieldset>
      </div>
    </div>
  );
};
