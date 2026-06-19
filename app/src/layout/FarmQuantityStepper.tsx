"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type FarmQuantityStepperProps = {
  value: number;
  min?: number;
  max: number;
  disabled?: boolean;
  onChange: (quantity: number) => void;
  label?: string;
};

export function FarmQuantityStepper({
  value,
  min = 1,
  max,
  disabled,
  onChange,
  label = "Quantity",
}: FarmQuantityStepperProps) {
  const setQuantity = (quantity: number) =>
    onChange(Math.max(min, Math.min(max, Math.floor(quantity || min))));
  return (
    <fieldset className="flex items-center gap-1">
      <legend className="sr-only">{label}</legend>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-8 w-8"
        disabled={disabled || value <= min}
        onClick={() => setQuantity(value - 1)}
        aria-label={`Decrease ${label.toLowerCase()}`}
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <Input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => setQuantity(Number(event.target.value))}
        className="h-8 w-16 text-center"
      />
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-8 w-8"
        disabled={disabled || value >= max}
        onClick={() => setQuantity(value + 1)}
        aria-label={`Increase ${label.toLowerCase()}`}
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </fieldset>
  );
}
