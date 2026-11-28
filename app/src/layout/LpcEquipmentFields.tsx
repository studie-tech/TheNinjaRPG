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
import { useLpcDesigns } from "@/hooks/lpc";
import { CharacterPreview } from "@/layout/CharacterPreview";
import { LpcAnimationCoverage } from "@/layout/LpcAnimationCoverage";
import { LpcDesignBrowser } from "@/layout/LpcDesignBrowser";
import {
  resolveItemSprite,
  type SpriteItem,
  type SpriteVariant,
} from "@/libs/lpc/appearance";
import { lpcDesignColors } from "@/libs/lpc/designs";
import { cn } from "@/libs/shadui";
import type { LpcBody } from "@/validators/lpc";
import { lpcMaterials } from "@/validators/lpc";

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
  const { data: designs, error: designError } = useLpcDesigns();
  const [body, setBody] = useState<LpcBody>("male");
  const [profile, color, materialColors] = useWatch({
    control,
    name: ["lpcProfile", "lpcColor", "lpcMaterialColors"] as Path<T>[],
  });
  const overrides = {
    lpcProfile: profile || null,
    lpcColor: color || null,
    lpcMaterialColors: materialColors || null,
  } as SpriteVariant;
  // Variant drafts inherit the saved base; base drafts replace their own saved overrides.
  const previewItem = variant ? item : { ...item, ...overrides };
  const previewVariant = variant ? { ...variant, ...overrides } : undefined;
  const visual = resolveItemSprite(previewItem, previewVariant);
  const selectedDesign = designs?.find(
    (design) => design.id === visual.profile,
  )?.lpcConfig;
  const availableColors = selectedDesign ? lpcDesignColors(selectedDesign) : [];
  const lpcEquipmentProfiles = [
    { id: "AUTO", name: variant ? "Inherit item appearance" : "Not configured" },
    { id: "NONE", name: "Hidden on character" },
    ...(designs ?? [])
      .filter(
        (asset) =>
          (!asset.hidden || asset.id === visual.profile) &&
          asset.lpcConfig &&
          ["equipment", "headgear"].includes(asset.lpcConfig.category),
      )
      .map((asset) => ({
        id: asset.id,
        name: `${asset.name}${asset.hidden ? " (hidden)" : ""}`,
      })),
  ];

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
                    <SelectItem key={value.id} value={value.id}>
                      {value.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <LpcDesignBrowser
                designs={designs ?? []}
                selected={visual.profile}
                onSelect={field.onChange}
              />
              {designError && (
                <p role="alert" className="text-destructive text-sm">
                  Could not load designs. Refresh to try again.
                </p>
              )}
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
                  <SelectItem value="AUTO">
                    {variant ? "Inherit item colour" : "Automatic colour"}
                  </SelectItem>
                  {typeof field.value === "string" &&
                    field.value &&
                    !availableColors.includes(field.value) && (
                      <SelectItem value={field.value} disabled>
                        {field.value} (unavailable)
                      </SelectItem>
                    )}
                  {availableColors.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!variant && !field.value && (
                <p className="text-muted-foreground text-sm">
                  Uses gray when available, otherwise the design default.
                </p>
              )}
              {fieldState.error && (
                <p role="alert" className="text-destructive text-sm">
                  {fieldState.error.message}
                </p>
              )}
            </div>
          )}
        />
        {selectedDesign &&
          (color || (variant && item.lpcColor)) &&
          !availableColors.includes(visual.color) && (
            <p role="status" className="text-sm text-muted-foreground">
              The saved colour is unavailable on both builds. The preview uses the
              design default; choose an available colour to change it.
            </p>
          )}
        {selectedDesign &&
          lpcMaterials.map((material) => {
            const palettes = lpcDesignColors(
              selectedDesign,
              ["male", "female"],
              material,
            );
            if (!palettes.length) return null;
            return (
              <Controller
                key={material}
                control={control}
                name={"lpcMaterialColors" as Path<T>}
                render={({ field }) => {
                  const values = (field.value ?? {}) as Record<string, string | null>;
                  return (
                    <div className="grid gap-2">
                      <Label htmlFor={`${id}-${material}`}>
                        {material[0]!.toUpperCase() + material.slice(1)} colour
                      </Label>
                      <Select
                        value={values[material] ?? "AUTO"}
                        onValueChange={(value) =>
                          field.onChange({
                            ...values,
                            [material]: value === "AUTO" ? null : value,
                          })
                        }
                      >
                        <SelectTrigger id={`${id}-${material}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AUTO">
                            {variant ? "Inherit item material" : "Use equipment colour"}
                          </SelectItem>
                          {values[material] &&
                            !palettes.includes(values[material]!) && (
                              <SelectItem value={values[material]!} disabled>
                                {values[material]} (unavailable)
                              </SelectItem>
                            )}
                          {palettes.map((palette) => (
                            <SelectItem key={palette} value={palette}>
                              {palette}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                }}
              />
            );
          })}
        {selectedDesign && (
          <LpcAnimationCoverage
            config={selectedDesign}
            body={body}
            color={visual.color}
            materialColors={visual.materialColors}
          />
        )}
      </div>
      <div className="space-y-1 self-center">
        <CharacterPreview
          className="w-48 max-w-full"
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
