"use client";

import { Minus, Plus } from "lucide-react";
import { NumberInput } from "@/components/ui/number-input";

type FarmQuantityStepperProps = {
  value: number;
  min?: number;
  max: number;
  disabled?: boolean;
  onChange: (quantity: number) => void;
  label?: string;
  /** Adds a shortcut that sets the quantity to `max`. */
  showMax?: boolean;
};

/** Joined minus / quantity / plus control with an optional "Max" shortcut. */
export function FarmQuantityStepper({
  value,
  min = 1,
  max,
  disabled,
  onChange,
  label = "Quantity",
  showMax = false,
}: FarmQuantityStepperProps) {
  const setQuantity = (quantity: number) =>
    onChange(Math.max(min, Math.min(max, Math.floor(quantity || min))));
  const stepClassName =
    "grid w-8 shrink-0 place-items-center text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-40";

  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">{label}</legend>
      <div className="flex h-8 overflow-hidden rounded-md border bg-background">
        <button
          type="button"
          className={stepClassName}
          disabled={disabled || value <= min}
          onClick={() => setQuantity(value - 1)}
          aria-label={`Decrease ${label.toLowerCase()}`}
        >
          <Minus className="h-3.5 w-3.5" aria-hidden />
        </button>
        <NumberInput
          aria-label={label}
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          emptyFallback={min}
          className="h-full w-11 rounded-none border-0 border-x px-1 text-center font-medium tabular-nums shadow-none [appearance:textfield] focus-visible:ring-inset [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          className={stepClassName}
          disabled={disabled || value >= max}
          onClick={() => setQuantity(value + 1)}
          aria-label={`Increase ${label.toLowerCase()}`}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {showMax && max > min && (
        <button
          type="button"
          className="h-8 rounded-md px-2 font-medium text-muted-foreground text-xs hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
          disabled={disabled || value >= max}
          onClick={() => setQuantity(max)}
          aria-label={`Set ${label.toLowerCase()} to the maximum, ${max}`}
        >
          Max
        </button>
      )}
    </fieldset>
  );
}
