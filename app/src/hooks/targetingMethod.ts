import { useEffect, useRef } from "react";
import { type FieldValues, type UseFormReturn, useWatch } from "react-hook-form";

interface TargetingValues {
  method: string;
  coordinateTargeting: unknown;
  methodSize: unknown;
}

/**
 * Keep an action editor's method-specific fields in step with its targeting method and
 * return the form entries the selected method exposes. Call once, right after `useForm`.
 */
export const useTargetingMethodFields = <TInput extends FieldValues, TOutput>(
  form: UseFormReturn<TInput, unknown, TOutput>,
) => {
  // Item and jutsu forms both hold these fields; their generics cannot express that here.
  const targetingForm = form as unknown as UseFormReturn<TargetingValues>;
  // Keep parent-owned objects registered while their conditional editors are hidden.
  targetingForm.register("coordinateTargeting");
  targetingForm.register("methodSize");

  const targetingMethod = useWatch({ control: targetingForm.control, name: "method" });
  const previousTargetingMethod = useRef(targetingMethod);
  useEffect(() => {
    if (
      previousTargetingMethod.current === "COORDINATES" &&
      targetingMethod !== "COORDINATES"
    ) {
      targetingForm.setValue("coordinateTargeting", null, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    // Clear inactive expansion so a hidden draft cannot block schema validation.
    if (targetingMethod === "ALL" || targetingMethod === "COORDINATES") {
      targetingForm.setValue("methodSize", null, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    previousTargetingMethod.current = targetingMethod;
  }, [targetingMethod, targetingForm]);

  return [
    ...(targetingMethod !== "ALL" && targetingMethod !== "COORDINATES"
      ? [{ id: "methodSize" as const, type: "method_size" as const, fullWidth: true }]
      : []),
    ...(targetingMethod === "COORDINATES"
      ? [
          {
            id: "coordinateTargeting" as const,
            label: "Coordinate pattern",
            type: "coordinate_targeting" as const,
            fullWidth: true,
          },
        ]
      : []),
  ];
};
