"use client";

import { type UseFormReturn, useFormState, useWatch } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Textarea } from "@/components/ui/textarea";
import { AbilityListEditor } from "@/layout/AbilityListEditor";
import { EnumField, Field, TOUCH_FIELD } from "@/layout/cardEditorFields";
import { type DraftAbility, parsedAbility } from "@/libs/kessen/abilityEditor";
import {
  cardTextPlain,
  type KESSEN_TERMS,
  keywordBudgetIssue,
  ROW_LABELS,
} from "@/libs/kessen/text";
import type { ZodItemInput, ZodItemType } from "@/validators/combat";
import {
  type CardData,
  cardDataSchema,
  DEFAULT_CARD_DATA,
  KessenCardKinds,
  KessenCardVariants,
  KessenFactions,
  KessenRows,
} from "@/validators/itemCard";

/**
 * Staff editor for a card's Kessen stats (`Item.cardData`). Scalars use plain controls;
 * abilities are edited as a list in printed order and previewed as printed card text.
 * Item-level validation (keyword budget by rarity, tradeability) reports under this section.
 */
export function CardDataEditor({ form, groups, disabled }: CardDataEditorProps) {
  const watched = useWatch({ control: form.control, name: "cardData" });
  const rarity = useWatch({ control: form.control, name: "rarity" });
  const { errors } = useFormState({ control: form.control, name: "cardData" });
  const card = { ...DEFAULT_CARD_DATA, ...(watched as Partial<CardData> | null) };
  const abilities: DraftAbility[] = Array.isArray(card.abilities) ? card.abilities : [];
  const update = (patch: Partial<CardData>) =>
    form.setValue(
      "cardData",
      { ...card, ...patch },
      { shouldDirty: true, shouldValidate: true },
    );
  const messages = collectErrorMessages({ ...errors.cardData, abilities: undefined });
  // Entries report their own problems; these concern the list as a whole.
  const abilityMessages = (
    cardDataSchema
      .safeParse(card)
      .error?.issues.filter(
        ({ path }) => path.length === 1 && path[0] === "abilities",
      ) ?? []
  ).map((issue) => issue.message);
  const preview = abilities.flatMap((ability) => parsedAbility(ability) ?? []);
  const overBudget =
    card.kind === "LEADER" ? null : keywordBudgetIssue(preview, rarity);
  if (overBudget) abilityMessages.push(overBudget);
  const groupOptions = [...new Set([...card.summonGroups, ...(groups ?? [])])].sort();
  const isDisabled = disabled ?? false;

  return (
    <section
      aria-labelledby="card-data-heading"
      className="@container mt-3 rounded-md border p-2"
    >
      <h3 id="card-data-heading" className="mb-2 text-lg font-semibold">
        Card
      </h3>
      <div className="grid grid-cols-1 items-start gap-x-3 gap-y-3 @min-[440px]:grid-cols-2 @min-[900px]:grid-cols-3">
        <EnumField
          id="card-kind"
          label="Kind"
          value={card.kind}
          values={KessenCardKinds}
          disabled={isDisabled}
          onChange={(kind) => update({ kind, row: kind === "UNIT" ? card.row : null })}
        />
        <EnumField
          id="card-faction"
          label="Faction"
          value={card.faction}
          values={KessenFactions}
          disabled={isDisabled}
          onChange={(faction) => update({ faction })}
        />
        <EnumField
          id="card-row"
          label="Row"
          help="Units only; None for tactics and leaders."
          value={card.row ?? NO_ROW}
          values={[...KessenRows, "ANY", NO_ROW]}
          labels={ROW_OPTION_LABELS}
          disabled={isDisabled}
          onChange={(row) => update({ row: row === NO_ROW ? null : row })}
        />
        <NumberField
          id="card-power"
          label="Power"
          value={card.power}
          disabled={isDisabled}
          onChange={(power) => update({ power })}
        />
        <NumberField
          id="card-provision"
          label="Provision"
          help="Deck-building cost; leaders use 0."
          value={card.provision}
          disabled={isDisabled}
          onChange={(provision) => update({ provision })}
        />
        <NumberField
          id="card-leader-bonus"
          label="Leader bonus"
          help="Provision a leader adds to its deck."
          value={card.leaderBonus}
          disabled={isDisabled}
          onChange={(leaderBonus) => update({ leaderBonus })}
        />
        <EnumField
          id="card-variant"
          label="Variant"
          value={card.variant}
          values={KessenCardVariants}
          disabled={isDisabled}
          onChange={(variant) => update({ variant })}
        />
        <Field
          id="card-base"
          label="Base card"
          help="Forbidden variants: the standard card's item id."
        >
          <Input
            id="card-base"
            className={TOUCH_FIELD}
            value={card.baseCardId ?? ""}
            disabled={isDisabled}
            aria-describedby="card-base-help"
            onChange={(event) =>
              update({ baseCardId: event.target.value.trim() || null })
            }
          />
        </Field>
        <Field
          id="card-collectible"
          label="Collectible"
          className="@min-[440px]:col-span-2 @min-[900px]:col-span-1"
        >
          <label
            htmlFor="card-collectible"
            className="flex h-9 cursor-pointer items-center gap-2 pointer-coarse:h-[40px]"
          >
            <Checkbox
              id="card-collectible"
              className="pointer-coarse:size-6"
              checked={card.isCollectible}
              disabled={isDisabled}
              aria-describedby="card-collectible-help"
              onCheckedChange={(checked) => update({ isCollectible: checked === true })}
            />
            <span
              id="card-collectible-help"
              className="text-muted-foreground text-[11px]"
            >
              Appears in packs, decks and shops
            </span>
          </label>
        </Field>
        <Field
          id="card-art"
          label="Portrait URL"
          help="5:7 portrait art served from the CDN."
          className="@min-[440px]:col-span-2"
        >
          <Input
            id="card-art"
            className={TOUCH_FIELD}
            value={card.artUrl}
            disabled={isDisabled}
            aria-describedby="card-art-help"
            onChange={(event) => update({ artUrl: event.target.value.trim() })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-x-3 @min-[440px]:col-span-2 @min-[900px]:col-span-1">
          <NumberField
            id="card-focal-x"
            label="Focal X (%)"
            value={card.focalX}
            disabled={isDisabled}
            onChange={(focalX) => update({ focalX })}
          />
          <NumberField
            id="card-focal-y"
            label="Focal Y (%)"
            value={card.focalY}
            disabled={isDisabled}
            onChange={(focalY) => update({ focalY })}
          />
        </div>
        <Field
          id="card-summon-groups"
          label="Summon groups"
          help="Comma separated, up to three."
          className="col-span-full"
        >
          <Input
            id="card-summon-groups"
            className={TOUCH_FIELD}
            value={card.summonGroups.join(", ")}
            disabled={isDisabled}
            aria-describedby="card-summon-groups-help"
            onChange={(event) =>
              update({
                summonGroups: event.target.value
                  .split(",")
                  .map((group) => group.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <Field id="card-flavor" label="Flavor text" className="col-span-full">
          <Textarea
            id="card-flavor"
            rows={2}
            value={card.flavor}
            disabled={isDisabled}
            onChange={(event) => update({ flavor: event.target.value })}
          />
        </Field>
        <AbilityListEditor
          className="col-span-full"
          abilities={abilities}
          cardKind={card.kind}
          groups={groupOptions}
          errors={[...new Set(abilityMessages)]}
          disabled={isDisabled}
          onChange={(next) => update({ abilities: next as CardData["abilities"] })}
        />
        <div className="col-span-full grid gap-1.5">
          <p className="text-sm leading-none font-medium">Card text</p>
          {preview.length > 0 ? (
            <p className="text-sm">{cardTextPlain({ abilities: preview })}</p>
          ) : (
            <p className="text-muted-foreground text-sm">No abilities</p>
          )}
        </div>
        {messages.length > 0 && (
          <ul
            role="alert"
            className="text-destructive col-span-full list-disc pl-5 text-sm"
          >
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NumberField({
  id,
  label,
  help,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Field id={id} label={label} help={help}>
      <NumberInput
        id={id}
        className={TOUCH_FIELD}
        value={value}
        min={0}
        disabled={disabled}
        aria-describedby={help ? `${id}-help` : undefined}
        onValueChange={onChange}
      />
    </Field>
  );
}

/** Select value standing for a card without a row (tactics and leaders). */
const NO_ROW = "NONE";

const ROW_OPTION_LABELS = {
  ...ROW_LABELS,
  ANY: "Any row" satisfies keyof typeof KESSEN_TERMS,
  [NO_ROW]: "None",
};

/** Every validation message under the card data, with the field path it belongs to. */
const collectErrorMessages = (error: unknown, path: string[] = []): string[] => {
  if (!error || typeof error !== "object") return [];
  const own =
    "message" in error && typeof error.message === "string" && error.message
      ? [path.length > 0 ? `${path.join(".")}: ${error.message}` : error.message]
      : [];
  const nested = Object.entries(error)
    .filter(([key]) => key !== "ref" && key !== "message" && key !== "type")
    .flatMap(([key, value]) => collectErrorMessages(value, [...path, key]));
  return [...new Set([...own, ...nested])];
};

interface CardDataEditorProps {
  form: UseFormReturn<ZodItemInput, unknown, ZodItemType>;
  /** Bond and Summon groups other cards use, suggested while typing one. */
  groups?: readonly string[];
  disabled?: boolean;
}
