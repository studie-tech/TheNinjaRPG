import { RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UserPet } from "@/drizzle/schema";
import Modal from "@/layout/Modal";
import { PET_AURAS, PET_CHARACTERISTICS, PET_PALETTES } from "@/libs/pets/catalogue";
import { canChoosePetAppearance } from "@/libs/pets/progression";

/** Choose a founder's initial cosmetics; redraws and evolutions retain the saved traits. */
export function PetAppearanceButton({
  pet,
  options,
  dayKey,
  disabled,
  variant,
  children,
  onGenerate,
}: PetAppearanceButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState(() => savedTraits(pet));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const canChoose = canChoosePetAppearance(pet);
  const fields = [
    {
      field: "paletteIndex",
      label: "Palette",
      choices: options.palettes,
      catalogue: PET_PALETTES,
    },
    {
      field: "characteristicIndex",
      label: "Characteristic",
      choices: options.characteristics,
      catalogue: PET_CHARACTERISTICS,
    },
    { field: "auraIndex", label: "Aura", choices: options.auras, catalogue: PET_AURAS },
  ] as const;

  return (
    <>
      <Button
        ref={buttonRef}
        disabled={disabled}
        variant={variant}
        onClick={() => {
          if (!canChoose) {
            void onGenerate();
            return;
          }
          // Closing the picker discards its draft; reopening starts from the saved traits.
          setDraft(savedTraits(pet));
          setIsOpen(true);
        }}
      >
        <RefreshCw className="mr-2 h-4 w-4" />
        {children}
      </Button>
      {isOpen && canChoose && (
        <Modal
          title="Choose companion appearance"
          isOpen={isOpen}
          setIsOpen={setIsOpen}
          returnFocusRef={buttonRef}
          proceed_label="Generate appearance"
          proceedDisabled={disabled}
          onAccept={() => {
            // Close before the long request so feedback remains in the owning panel.
            setIsOpen(false);
            void onGenerate({ dayKey, ...draft });
          }}
        >
          <p className="text-muted-foreground text-sm">
            Choose today's traits for {pet.name}. Each accepted image uses one image
            attempt; failed generations are refunded. The new image and traits replace
            the current appearance only after generation succeeds. Creating the image
            can take a few minutes.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {fields.map(({ field, label, choices, catalogue }) => {
              const current = catalogue[pet[field]];
              // Saved traits remain selectable after their daily offer has rotated out.
              const available =
                current && !choices.some(({ index }) => index === current.index)
                  ? [{ ...current, name: `${current.name} (current)` }, ...choices]
                  : choices;
              return (
                <div key={field} className="min-w-0 space-y-1">
                  <Label htmlFor={`pet-appearance-${field}`}>{label}</Label>
                  <Select
                    value={String(draft[field])}
                    disabled={disabled}
                    onValueChange={(value) =>
                      setDraft((previous) => ({ ...previous, [field]: Number(value) }))
                    }
                  >
                    <SelectTrigger id={`pet-appearance-${field}`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      onKeyDown={(event) => {
                        // Enter chooses a trait without reaching the modal's confirmation shortcut.
                        if (event.key === "Enter") event.stopPropagation();
                      }}
                    >
                      {available.map((option) => (
                        <SelectItem key={option.index} value={String(option.index)}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </Modal>
      )}
    </>
  );
}

/** The pet's saved cosmetic indices, where every picker draft starts. */
const savedTraits = (pet: PetAppearanceButtonProps["pet"]) => ({
  paletteIndex: pet.paletteIndex,
  characteristicIndex: pet.characteristicIndex,
  auraIndex: pet.auraIndex,
});

type PetAppearanceButtonProps = {
  pet: Pick<
    UserPet,
    | "name"
    | "rank"
    | "artRank"
    | "avatar"
    | "paletteIndex"
    | "characteristicIndex"
    | "auraIndex"
  >;
  options: RouterOutputs["pets"]["getPet"]["options"];
  dayKey: string;
  disabled: boolean;
  variant?: ButtonProps["variant"];
  children: ReactNode;
  onGenerate: (
    appearance?: RouterInputs["pets"]["generateAppearance"]["appearance"],
  ) => Promise<void>;
};
