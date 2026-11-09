"use client";

import { Loader2, Plus, X } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MAX_ATTRIBUTES } from "@/drizzle/constants";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { CharacterPreview } from "@/layout/CharacterPreview";
import { showMutationToast } from "@/libs/toast";
import type { BaseServerResponse } from "@/server/api/trpc";
import { useRequiredUserData } from "@/utils/UserContext";
import {
  attributes,
  type Color,
  colors,
  getAttributeGroup,
  getCharacterAttributes,
  type SkinColor,
  skin_colors,
} from "@/validators/register";

/** Edit saved palettes and compatible traits while sharing the authoritative appearance snapshot. */
export const AttributeChange: React.FC = () => {
  const { data: spriteUser, updateUser: updateSpriteUser } = useRequiredUserData();
  const saveFlight = useSingleFlight<string>();
  const pendingAttribute = saveFlight.pending;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const {
    data,
    refetch,
    isPending: isLoading,
  } = api.profile.getUserAttributes.useQuery(undefined);
  const choices = getCharacterAttributes(
    (data ?? spriteUser?.attributes ?? []).map((row) => row.attribute),
  );
  const isBusy = pendingAttribute !== null || isLoading;
  const { mutateAsync: insertAttr } = api.profile.insertAttribute.useMutation();
  const { mutateAsync: deleteAttr } = api.profile.deleteAttribute.useMutation();
  const bodyMutation = api.profile.updateSpriteBody.useMutation({
    onSuccess: async (result) => {
      showMutationToast(result);
      if (result.success && result.userPatch) await updateSpriteUser(result.userPatch);
    },
  });

  // Attribute mutations refetch their query; the shared snapshot also refreshes sector visuals.
  useEffect(() => {
    if (
      spriteUser &&
      data &&
      JSON.stringify(data.map(({ attribute }) => attribute)) !==
        JSON.stringify(spriteUser.attributes?.map(({ attribute }) => attribute))
    )
      void updateSpriteUser({ attributes: data });
  }, [data, updateSpriteUser, spriteUser?.attributes]);

  const saveSelection = async (
    attribute: string,
    save: () => Promise<BaseServerResponse>,
  ) => {
    await saveFlight.run(attribute, async () => {
      setErrorMessage(null);
      try {
        const result = await save();
        showMutationToast(result);
        if (result.success) await refetch();
        else setErrorMessage(result.message ?? "Could not save appearance. Try again.");
      } catch (error) {
        // The shared handler reports transport failures; keep the saved selection and allow retry here.
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Could not save appearance. Try again.",
        );
      }
    });
  };

  return (
    <div className="space-y-3 py-3">
      <div className="flex items-start gap-3">
        <CharacterPreview
          className="mx-0 w-28 max-w-[35%] shrink-0 sm:w-36"
          user={{ ...spriteUser, attributes: data ?? spriteUser?.attributes }}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <Label htmlFor="character-body-style">Body style</Label>
            <Select
              disabled={bodyMutation.isPending}
              value={
                spriteUser?.spriteBodyStyle ??
                (spriteUser?.gender === "Female" ? "female" : "male")
              }
              onValueChange={(body) =>
                bodyMutation.mutate({ body: body as "male" | "female" })
              }
            >
              <SelectTrigger id="character-body-style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Broad build</SelectItem>
                <SelectItem value="female">Slender build</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <p className="font-medium text-sm">
              Current traits ({choices.traits.length}/{MAX_ATTRIBUTES})
            </p>
            <div className="flex flex-wrap gap-1">
              {choices.traits.map((attribute) => (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  key={attribute}
                  aria-label={`Remove ${attribute}`}
                  disabled={isBusy}
                  aria-busy={pendingAttribute === attribute}
                  className="h-auto min-h-8 max-w-full justify-start whitespace-normal bg-popover px-2 py-1 text-left"
                  onClick={() =>
                    void saveSelection(attribute, () => deleteAttr({ attribute }))
                  }
                >
                  <span>{attribute}</span>
                  {pendingAttribute === attribute ? (
                    <Loader2 className="ml-1 h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <X className="ml-1 h-3 w-3 shrink-0" aria-hidden="true" />
                  )}
                </Button>
              ))}
              {choices.traits.length === 0 && (
                <p className="text-muted-foreground text-sm">No traits selected</p>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(
          [
            { attribute: "Eyes", label: "Eye color", options: colors },
            { attribute: "Skin", label: "Skin color", options: skin_colors },
            { attribute: "Hair", label: "Hair color", options: colors },
          ] as const
        ).map(({ attribute, label, options }) => (
          <div
            key={attribute}
            className="min-w-0 space-y-1"
            aria-busy={pendingAttribute === attribute}
          >
            <Label htmlFor={`character-${attribute}`}>
              {label}
              {pendingAttribute === attribute && (
                <Loader2
                  className="ml-1 inline h-3 w-3 animate-spin"
                  aria-label="Saving"
                />
              )}
            </Label>
            <Select
              value={choices[attribute]}
              disabled={isBusy}
              onValueChange={(value) =>
                void saveSelection(attribute, () =>
                  insertAttr({ attribute, color: value as Color | SkinColor }),
                )
              }
            >
              <SelectTrigger id={`character-${attribute}`} className="min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!(options as readonly string[]).includes(choices[attribute]) && (
                  <SelectItem value={choices[attribute]}>
                    {choices[attribute]}
                  </SelectItem>
                )}
                {options.map((color) => (
                  <SelectItem key={color} value={color}>
                    {color}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      {choices.traits.includes("Bald") && (
        <p className="text-muted-foreground text-sm">
          Bald hides scalp hair; hair color still applies to beards.
        </p>
      )}
      <div className="space-y-1">
        <p className="font-medium text-sm">Available traits</p>
        <p className="text-muted-foreground text-sm">
          Choose one hair style, one face shape and one beard style.
        </p>
        <div className="flex flex-wrap gap-1">
          {attributes
            .filter((attribute) => !choices.traits.includes(attribute))
            .map((attribute) => {
              const replacesTrait = choices.traits.some((trait) =>
                getAttributeGroup(attribute).includes(trait),
              );
              return (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  key={attribute}
                  aria-label={`Add ${attribute}`}
                  disabled={
                    isBusy ||
                    (!replacesTrait && choices.traits.length >= MAX_ATTRIBUTES)
                  }
                  aria-busy={pendingAttribute === attribute}
                  className="h-auto min-h-8 max-w-full justify-start whitespace-normal bg-popover px-2 py-1 text-left"
                  onClick={() =>
                    void saveSelection(attribute, () => insertAttr({ attribute }))
                  }
                >
                  {pendingAttribute === attribute ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
                  )}
                  <span>{attribute}</span>
                </Button>
              );
            })}
        </div>
      </div>
      {errorMessage && (
        <p role="alert" className="text-destructive text-sm">
          {errorMessage}
        </p>
      )}
    </div>
  );
};
