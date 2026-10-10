"use client";

import { type ChangeEvent, useState } from "react";
import { Input, type InputProps } from "@/components/ui/input";

/** Numeric fields keep their editing text until the parent supplies a new value.
 * Invalid required drafts emit NaN, so forms and action guards cannot use stale values.
 */
export function NumberInput({
  value,
  defaultValue,
  onValueChange,
  onOptionalValueChange,
  onTextChange,
  onChange,
  onInput,
  onBlur,
  onKeyDown,
  optional,
  emptyFallback,
  step = 1,
  inputMode = step === 1 || step === "1" ? "numeric" : "decimal",
  ...props
}: NumberInputProps) {
  const [draft, setDraft] = useState({ source: value, text: formatValue(value) });
  const [isInvalid, setIsInvalid] = useState(false);
  const text = Object.is(draft.source, value) ? draft.text : formatValue(value);

  return (
    <Input
      {...props}
      type="number"
      data-number-input=""
      step={step}
      inputMode={inputMode}
      required={props.required ?? !optional}
      value={
        value === undefined && !onValueChange && !onOptionalValueChange && !onTextChange
          ? undefined
          : text
      }
      defaultValue={defaultValue}
      aria-invalid={
        props["aria-invalid"] ??
        ((Object.is(draft.source, value) && isInvalid) || undefined)
      }
      // Input also fires for incomplete prefixes whose numeric value is still empty.
      onInput={(event) => {
        const input = event.currentTarget;
        const raw = input.value;
        const isEmpty = raw === "" && !input.validity.badInput;
        const valid = input.validity.valid;
        const next = valid && !isEmpty ? input.valueAsNumber : Number.NaN;
        setDraft({
          source: onTextChange
            ? raw
            : onOptionalValueChange && isEmpty
              ? undefined
              : next,
          text: raw,
        });
        setIsInvalid(!valid);
        onTextChange?.(raw);
        if (onOptionalValueChange) onOptionalValueChange(isEmpty ? undefined : next);
        else onValueChange?.(next);
        if (!onValueChange && !onOptionalValueChange && !onTextChange)
          onChange?.(event as unknown as ChangeEvent<HTMLInputElement>);
        onInput?.(event);
      }}
      onBlur={(event) => {
        if (
          emptyFallback !== undefined &&
          event.currentTarget.value === "" &&
          !event.currentTarget.validity.badInput
        ) {
          event.currentTarget.value = String(emptyFallback);
          const valid = event.currentTarget.validity.valid;
          const next = valid ? emptyFallback : Number.NaN;
          setDraft({ source: onTextChange ? String(next) : next, text: String(next) });
          setIsInvalid(!valid);
          onTextChange?.(String(next));
          onValueChange?.(next);
          onOptionalValueChange?.(next);
          if (!onValueChange && !onOptionalValueChange && !onTextChange)
            onChange?.(event as unknown as ChangeEvent<HTMLInputElement>);
        }
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.currentTarget.checkValidity()) {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.reportValidity();
          return;
        }
        onKeyDown?.(event);
      }}
    />
  );
}

function formatValue(value: InputProps["value"]) {
  return (typeof value === "number" && !Number.isFinite(value)) ||
    value === "NaN" ||
    value === "Infinity" ||
    value === "-Infinity"
    ? ""
    : (value ?? "").toString();
}

export function validateNumberInputs(container: HTMLElement | null) {
  const inputs = container?.querySelectorAll<HTMLInputElement>(
    "input[data-number-input]",
  );
  for (const input of inputs ?? []) {
    if (!input.reportValidity()) return false;
  }
  return true;
}

type NumberInputProps = Omit<InputProps, "type" | "onChange"> & {
  onChange?: InputProps["onChange"];
  onTextChange?: (value: string) => void;
  emptyFallback?: number;
  optional?: boolean;
  onValueChange?: (value: number) => void;
  onOptionalValueChange?: (value: number | undefined) => void;
};
