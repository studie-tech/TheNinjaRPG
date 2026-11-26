"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EnumField, Field, TOUCH_FIELD } from "@/layout/cardEditorFields";
import {
  ABILITY_KIND_LABELS,
  type AbilityField,
  abilityFields,
  abilityIssues,
  type DraftAbility,
  draftAbility,
  isAbilityKind,
  isLeaderOnlyAbility,
  parsedAbility,
  withAbilityField,
} from "@/libs/kessen/abilityEditor";
import { cardTextPlain, KESSEN_GLOSSARY, keywordOf } from "@/libs/kessen/text";
import { cn } from "@/libs/shadui";
import {
  KESSEN_ABILITY_KINDS,
  KESSEN_MAX_ABILITIES,
  type KessenAbilityKind,
  type KessenCardKind,
} from "@/validators/itemCard";

/**
 * A card's abilities in printed order: each entry picks its verb and the verb's fields.
 * Order matters (a Seal and the Strike that follows it print as one sentence), so entries
 * move up and down. Problems of one field show under it, those of the list below it.
 */
export function AbilityListEditor({
  abilities,
  cardKind,
  sets,
  errors,
  disabled,
  onChange,
  className,
}: AbilityListEditorProps) {
  const headingId = useId();
  const setListId = useId();
  // Editor-only entry ids, so a half-typed amount and the focus follow a moved entry.
  const [storedIds, setStoredIds] = useState<readonly number[]>([]);
  const ids = entryIds(storedIds, abilities.length);
  const commit = (next: DraftAbility[], nextIds: readonly number[]) => {
    setStoredIds(nextIds);
    onChange(next);
  };
  const replace = (index: number, ability: DraftAbility) =>
    onChange(abilities.map((entry, at) => (at === index ? ability : entry)));
  const move = (index: number, step: -1 | 1) =>
    commit(moved(abilities, index, step), moved(ids, index, step));
  const remove = (index: number) =>
    commit(without(abilities, index), without(ids, index));
  const isFull = abilities.length >= KESSEN_MAX_ABILITIES;

  return (
    <fieldset
      aria-labelledby={headingId}
      className={cn("@container grid min-w-0 gap-2", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={headingId} className="text-sm leading-none font-medium">
          Abilities{" "}
          <span className="text-muted-foreground font-normal">
            {abilities.length} of {KESSEN_MAX_ABILITIES}, in printed order
          </span>
        </p>
        <Button
          type="button"
          variant="outline"
          className="h-9 pointer-coarse:h-[40px]"
          disabled={disabled || isFull}
          onClick={() => onChange([...abilities, draftAbility("strike")])}
        >
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Add ability
        </Button>
      </div>
      {abilities.length === 0 && (
        <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
          This card has no abilities.
        </p>
      )}
      {abilities.length > 0 && (
        <ol className="grid gap-2 @min-[760px]:grid-cols-2">
          {abilities.map((ability, index) => (
            <AbilityEntry
              key={ids[index]}
              ability={ability}
              index={index}
              count={abilities.length}
              cardKind={cardKind}
              sets={sets}
              setListId={setListId}
              disabled={disabled}
              onChange={(next) => replace(index, next)}
              onMove={(step) => move(index, step)}
              onRemove={() => remove(index)}
            />
          ))}
        </ol>
      )}
      <datalist id={setListId}>
        {sets.map((set) => (
          <option key={set} value={set} />
        ))}
      </datalist>
      {errors.length > 0 && (
        <ul role="alert" className="text-destructive list-disc pl-5 text-sm">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** One ability: what it prints, its verb and fields, and its place in the list. */
function AbilityEntry({
  ability,
  index,
  count,
  cardKind,
  sets,
  setListId,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  ability: DraftAbility;
  index: number;
  count: number;
  cardKind: KessenCardKind;
  sets: readonly string[];
  setListId: string;
  disabled: boolean;
  onChange: (ability: DraftAbility) => void;
  onMove: (step: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const kind = isAbilityKind(ability.k) ? ability.k : null;
  const fields = abilityFields(kind);
  const issues = abilityIssues(ability);
  const parsed = parsedAbility(ability);
  const keyword = parsed && keywordOf(parsed);
  const name = `Ability ${index + 1}`;

  return (
    <li className="bg-card grid min-w-0 content-start gap-2 rounded-md border p-2">
      <div className="flex items-center gap-1">
        <span className="w-5 shrink-0 text-sm font-semibold" aria-hidden>
          {index + 1}.
        </span>
        <Select
          value={kind ?? ""}
          disabled={disabled}
          onValueChange={(next) =>
            onChange(
              draftAbility(next as KessenAbilityKind, {
                from: ability,
                set: sets[0],
              }),
            )
          }
        >
          <SelectTrigger
            className={cn(TOUCH_FIELD, "min-w-0 flex-1 font-semibold")}
            aria-label={`${name}: ability`}
            aria-invalid={kind === null}
          >
            <SelectValue placeholder="Choose an ability" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {KESSEN_ABILITY_KINDS.filter(
                (option) => !isLeaderOnlyAbility(option),
              ).map((option) => (
                <SelectItem key={option} value={option}>
                  {ABILITY_KIND_LABELS[option]}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Leaders only</SelectLabel>
              {KESSEN_ABILITY_KINDS.filter(isLeaderOnlyAbility).map((option) => (
                <SelectItem
                  key={option}
                  value={option}
                  disabled={cardKind !== "LEADER" && option !== kind}
                >
                  {ABILITY_KIND_LABELS[option]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <IconButton
          label={`Move ${name} up`}
          disabled={disabled || index === 0}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton
          label={`Move ${name} down`}
          disabled={disabled || index === count - 1}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="h-4 w-4" aria-hidden />
        </IconButton>
        <IconButton label={`Remove ${name}`} disabled={disabled} onClick={onRemove}>
          <Trash2 className="h-4 w-4" aria-hidden />
        </IconButton>
      </div>
      {fields.length > 0 && (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          {fields.map((field) => (
            <AbilityFieldControl
              key={`${kind}-${field.name}`}
              id={`${id}-${field.name}`}
              entryName={name}
              field={field}
              value={ability[field.name]}
              error={issues.fields[field.name]}
              setListId={setListId}
              disabled={disabled}
              onChange={(value) =>
                onChange(withAbilityField(ability, field.name, value))
              }
            />
          ))}
        </div>
      )}
      {issues.entry.length > 0 && (
        <div className="text-destructive text-sm" role="alert">
          <p>{issues.entry.join(". ")}</p>
          <code className="text-xs break-all">{JSON.stringify(ability)}</code>
        </div>
      )}
      {parsed && (
        <p className="text-muted-foreground text-xs">
          {keyword
            ? KESSEN_GLOSSARY[keyword]
            : `${cardTextPlain({ abilities: [parsed] })}.`}
        </p>
      )}
    </li>
  );
}

/** The control of one ability field, with its problem below it. */
function AbilityFieldControl({
  id,
  entryName,
  field,
  value,
  error,
  setListId,
  disabled,
  onChange,
}: {
  id: string;
  entryName: string;
  field: AbilityField;
  value: unknown;
  error: string | undefined;
  setListId: string;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const label = `${entryName}: ${field.label}`;
  const described = error ? `${id}-error` : undefined;
  const message = error && (
    <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
      {error}
    </p>
  );
  switch (field.type) {
    case "amount":
      return (
        <Field id={id} label={field.label} className="flex-[0_1_88px]">
          <NumberInput
            id={id}
            className={TOUCH_FIELD}
            aria-label={label}
            aria-invalid={!!error}
            aria-describedby={described}
            value={value as number}
            min={field.min}
            max={field.max}
            disabled={disabled}
            onValueChange={onChange}
          />
          {message}
        </Field>
      );
    case "set":
      return (
        <Field id={id} label={field.label} className="flex-[1_1_150px]">
          <Input
            id={id}
            className={TOUCH_FIELD}
            aria-label={label}
            aria-invalid={!!error}
            aria-describedby={described}
            list={setListId}
            maxLength={field.maxLength}
            value={typeof value === "string" ? value : ""}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          />
          {message}
        </Field>
      );
    case "option":
      return (
        <div className="min-w-0 flex-[2_1_210px]">
          <EnumField
            id={id}
            label={field.label}
            ariaLabel={label}
            value={String(value ?? "")}
            values={field.options.map((option) => option.value)}
            labels={Object.fromEntries(
              field.options.map((option) => [option.value, option.label]),
            )}
            disabled={disabled}
            onChange={onChange}
          />
          {message}
        </div>
      );
    case "flag":
      return (
        <label
          htmlFor={id}
          className="flex min-h-9 flex-[1_1_100%] cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-[40px]"
        >
          <Checkbox
            id={id}
            className="pointer-coarse:size-6"
            aria-label={label}
            checked={value !== undefined}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange(checked === true ? field.value : undefined)
            }
          />
          {field.label}
          {message}
        </label>
      );
  }
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-9 w-9 shrink-0 pointer-coarse:h-[40px] pointer-coarse:w-[40px]"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** One unique id per entry: the known ones, then the lowest unused numbers. */
const entryIds = (known: readonly number[], count: number) => {
  const ids = known.slice(0, count);
  for (let id = 0; ids.length < count; id++) if (!ids.includes(id)) ids.push(id);
  return ids;
};

const without = <T,>(list: readonly T[], index: number) =>
  list.filter((_, at) => at !== index);

const moved = <T,>(list: readonly T[], index: number, step: -1 | 1) => {
  const next = [...list];
  next.splice(index + step, 0, ...next.splice(index, 1));
  return next;
};

interface AbilityListEditorProps {
  abilities: readonly DraftAbility[];
  cardKind: KessenCardKind;
  /** Known set names, suggested while typing the set a Bond or Summon names. */
  sets: readonly string[];
  /** Problems of the list as a whole. */
  errors: readonly string[];
  disabled: boolean;
  onChange: (abilities: DraftAbility[]) => void;
  className?: string;
}
