import { MinusCircle, PlusCircle } from "lucide-react";
import type { UseFormRegister, UseFormSetValue } from "react-hook-form";
import { useDebouncedCallback } from "@/hooks/useDebouncedCallback";

interface SliderFieldProps {
  id: string;
  label?: string;
  default: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  error?: string;
  watchedValue: number;
  watchedTotal?: number;
  formatWatchedValue?: (value: number) => string;
  setValue: UseFormSetValue<any>;
  register: UseFormRegister<any>;
  preventDebounce?: boolean;
  disabled?: boolean;
}

const SliderField: React.FC<SliderFieldProps> = (props) => {
  // Debounced setValue
  const debouncedSetValue = useDebouncedCallback(
    (id: string, value: number) => props.setValue(id, value),
    250,
  );

  // Debounced setValue for slider changes
  const handleChange = (id: string, value: number) => {
    if (props.disabled) return;

    if (props.preventDebounce) {
      props.setValue(id, value);
    } else {
      debouncedSetValue(id, value);
    }
  };

  // The selection is always shown, including zero, without forced decimals.
  const selectedLabel = props.formatWatchedValue
    ? props.formatWatchedValue(props.watchedValue)
    : [
        `Selected: ${formatSliderNumber(props.watchedValue)}`,
        props.watchedTotal !== undefined
          ? `/ ${formatSliderNumber(props.watchedTotal)}`
          : "",
        props.unit ?? "",
      ]
        .filter(Boolean)
        .join(" ");

  return (
    <div className="m-1">
      <label htmlFor={props.id} className="mb-2 block font-medium">
        {props.label ? `${props.label}.` : ""}
        {selectedLabel ? ` ${selectedLabel}` : ""}
      </label>
      <SliderStepper
        disabled={props.disabled}
        onDecrement={() => {
          if (!props.disabled && props.watchedValue > props.min) {
            props.setValue(props.id, props.watchedValue - (props.step ?? 1));
          }
        }}
        onIncrement={() => {
          if (!props.disabled && props.watchedValue < props.max) {
            props.setValue(props.id, props.watchedValue + (props.step ?? 1));
          }
        }}
        inputProps={{
          id: props.id,
          min: props.min,
          max: props.max,
          step: props.step ?? 1,
          disabled: props.disabled,
          defaultValue: props.default,
          ...props?.register?.(props.id, { valueAsNumber: true }),
          onChange: (e) => handleChange(props.id, Number(e.target.value)),
        }}
      />
      {props.error && <p className="text-red-500 text-xs italic"> {props.error}</p>}
    </div>
  );
};

export default SliderField;

interface UncontrolledSliderFieldProps {
  id: string;
  label?: string;
  value: number;
  min: number;
  max: number;
  setValue: React.Dispatch<React.SetStateAction<number>>;
}
export const UncontrolledSliderField: React.FC<UncontrolledSliderFieldProps> = (
  props,
) => {
  return (
    <div className="m-1">
      <label htmlFor={props.id} className="mb-2 block font-medium">
        {props.label ? props.label : ""}
      </label>
      <SliderStepper
        onDecrement={() =>
          props.setValue(props.value > props.min ? props.value - 1 : props.value)
        }
        onIncrement={() =>
          props.setValue(props.value < props.max ? props.value + 1 : props.value)
        }
        inputProps={{
          id: props.id,
          value: props.value,
          min: props.min,
          max: props.max,
          onChange: (e) => props.setValue(parseInt(e.target.value, 10)),
        }}
      />
    </div>
  );
};

const STEPPER_ICON_CLASS = "inline-block h-10 w-10 fill-orange-100 text-orange-800";
const STEPPER_BUTTON_CLASS =
  "inline-flex shrink-0 rounded-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed";

/** The range input between its minus and plus buttons. */
const SliderStepper: React.FC<{
  disabled?: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
  inputProps: React.ComponentProps<"input">;
}> = ({ disabled, onDecrement, onIncrement, inputProps }) => {
  const iconState = disabled
    ? "cursor-not-allowed"
    : "hover:cursor-pointer hover:fill-orange-600";
  return (
    <div className={`flex flex-row items-center ${disabled ? "opacity-50" : ""}`}>
      <button
        type="button"
        aria-label="Decrease"
        aria-controls={inputProps.id}
        disabled={disabled}
        className={`mr-2 ${STEPPER_BUTTON_CLASS}`}
        onClick={onDecrement}
      >
        <MinusCircle className={`${STEPPER_ICON_CLASS} ${iconState}`} />
      </button>
      <input
        type="range"
        {...inputProps}
        className="h-5 w-full cursor-pointer appearance-none rounded-lg bg-orange-200 accent-orange-800 disabled:cursor-not-allowed"
      />
      <button
        type="button"
        aria-label="Increase"
        aria-controls={inputProps.id}
        disabled={disabled}
        className={`ml-2 ${STEPPER_BUTTON_CLASS}`}
        onClick={onIncrement}
      >
        <PlusCircle className={`${STEPPER_ICON_CLASS} ${iconState}`} />
      </button>
    </div>
  );
};

/** Thousands separators and at most two decimals, so whole values print as "500". */
export const formatSliderNumber = (value: number) =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });
