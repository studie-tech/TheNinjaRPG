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
  setValue: UseFormSetValue<any>;
  register: UseFormRegister<any>;
  preventDebounce?: boolean;
}

const SliderField: React.FC<SliderFieldProps> = (props) => {
  // Debounced setValue
  const debouncedSetValue = useDebouncedCallback(
    (id: string, value: number) => props.setValue(id, value),
    250,
  );

  // Debounced setValue for slider changes
  const handleChange = (id: string, value: number) => {
    if (props.preventDebounce) {
      props.setValue(id, value);
    } else {
      debouncedSetValue(id, value);
    }
  };

  return (
    <div className="m-1">
      <label htmlFor={props.id} className="mb-2 block font-medium">
        {props.label ? `${props.label}.` : ""}
        {props.watchedValue
          ? ` Selected: ${props.watchedValue.toFixed(2)} ${props.watchedTotal ? `/ ${props.watchedTotal.toFixed(2)}` : ""} ${props.unit ?? ""}`
          : ""}
      </label>
      <div className="flex flex-row items-center">
        <MinusCircle
          className="mr-2 inline-block h-10 w-10 fill-orange-100 text-orange-800 hover:cursor-pointer hover:fill-orange-600"
          onClick={() =>
            props.watchedValue > props.min
              ? props.setValue(props.id, props.watchedValue - (props.step ?? 1))
              : null
          }
        />
        <input
          id={props.id}
          type="range"
          min={props.min}
          max={props.max}
          step={props.step ?? 1}
          {...props?.register?.(props.id, { valueAsNumber: true })}
          className="h-5 w-full cursor-pointer appearance-none rounded-lg bg-orange-200 accent-orange-800"
          onChange={(e) => handleChange(props.id, Number(e.target.value))}
        />
        <PlusCircle
          className="ml-2 inline-block h-10 w-10 fill-orange-100 text-orange-800 hover:cursor-pointer hover:fill-orange-600"
          onClick={() =>
            props.watchedValue < props.max
              ? props.setValue(props.id, props.watchedValue + (props.step ?? 1))
              : null
          }
        />
      </div>
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
      <div className="flex flex-row items-center">
        <MinusCircle
          className="mr-2 inline-block h-10 w-10 fill-orange-100 text-orange-800 hover:cursor-pointer hover:fill-orange-600"
          onClick={() =>
            props.setValue(props.value > props.min ? props.value - 1 : props.value)
          }
        />
        <input
          id={props.id}
          type="range"
          value={props.value}
          min={props.min}
          max={props.max}
          onChange={(e) => props.setValue(parseInt(e.target.value, 10))}
          className="h-5 w-full cursor-pointer appearance-none rounded-lg bg-orange-200 accent-orange-800"
        />
        <PlusCircle
          className="ml-2 inline-block h-10 w-10 fill-orange-100 text-orange-800 hover:cursor-pointer hover:fill-orange-600"
          onClick={() =>
            props.setValue(props.value < props.max ? props.value + 1 : props.value)
          }
        />
      </div>
    </div>
  );
};
