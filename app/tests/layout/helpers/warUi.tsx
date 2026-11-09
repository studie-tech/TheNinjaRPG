import { vi } from "bun:test";
import { type ComponentProps, useState } from "react";
import * as select from "@/components/ui/select";

type MutationCallbacks<Result> = {
  onMutate?: () => number | undefined;
  onSuccess?: (
    result: Result,
    variables: unknown,
    revision: number | undefined,
  ) => void | Promise<void>;
  onError?: (error: Error) => void;
};

/** Keep transport controllable while preserving each component's pending and feedback lifecycle. */
export const controllableMutation = <Result,>() => {
  const mutate = vi.fn();
  let callbacks: MutationCallbacks<Result>;
  let revision: number | undefined;
  let setPending: (pending: boolean) => void;
  return {
    mutate,
    useMutation: (options: MutationCallbacks<Result>) => {
      const [isPending, setIsPending] = useState(false);
      const [variables, setVariables] = useState<unknown>();
      callbacks = options;
      setPending = setIsPending;
      return {
        isPending,
        variables,
        mutate: (input: unknown) => {
          revision = options.onMutate?.();
          mutate(input);
          setVariables(input);
          setIsPending(true);
        },
      };
    },
    respond: async (result: Result) => {
      await callbacks.onSuccess?.(result, undefined, revision);
      setPending(false);
    },
    fail: (message = "") => {
      callbacks.onError?.(new Error(message));
      setPending(false);
    },
  };
};

/** Render Radix selects as a native labelled `<select>`; restored by `vi.restoreAllMocks()`. */
export const stubSelect = (ariaLabel: string) => {
  vi.spyOn(select, "Select").mockImplementation(
    ({ value, onValueChange, children }: ComponentProps<typeof select.Select>) => (
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onValueChange?.(event.target.value)}
      >
        {children}
      </select>
    ),
  );
  vi.spyOn(select, "SelectTrigger").mockImplementation((() => <></>) as never);
  vi.spyOn(select, "SelectContent").mockImplementation((({
    children,
  }: ComponentProps<typeof select.SelectContent>) => <>{children}</>) as never);
  vi.spyOn(select, "SelectItem").mockImplementation((({
    value,
    children,
  }: ComponentProps<typeof select.SelectItem>) => (
    <option value={value}>{children}</option>
  )) as never);
};
