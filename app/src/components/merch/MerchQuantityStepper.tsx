import { Minus, Plus } from "lucide-react";
import { MERCH_MAX_QUANTITY } from "@/validators/merch";

/** Minus/plus quantity control, from 1 up to the per-item merch limit. */
export function MerchQuantityStepper({
  value,
  disabled,
  iconSize,
  label = "quantity",
  onChange,
}: {
  value: number;
  disabled: boolean;
  iconSize: number;
  /** Completes each button's accessible name, e.g. "quantity of Hoodie" */
  label?: string;
  onChange: (quantity: number) => void;
}) {
  return (
    <div className="merch-quantity">
      <button
        type="button"
        disabled={disabled || value <= 1}
        aria-label={`Decrease ${label}`}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={iconSize} />
      </button>
      <span>{value}</span>
      <button
        type="button"
        disabled={disabled || value >= MERCH_MAX_QUANTITY}
        aria-label={`Increase ${label}`}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={iconSize} />
      </button>
    </div>
  );
}
