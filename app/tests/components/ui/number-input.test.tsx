import { ensureDom } from "../../setup-dom.mjs";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
const { cleanup, fireEvent, render, waitFor } = await import("@testing-library/react");
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { NumberInput, validateNumberInputs } from "@/components/ui/number-input";

function Controlled({ initial = 1, ...props }: { initial?: number; min?: number; max?: number; step?: number | "any"; emptyFallback?: number }) {
  const [value, setValue] = useState(initial);
  return <><NumberInput aria-label="Amount" value={value} onValueChange={setValue} {...props} /><output>{Number.isNaN(value) ? "invalid" : value}</output><button type="button" onClick={() => setValue(4)}>Reset</button></>;
}

describe("NumberInput", () => {
  beforeEach(ensureDom);
  afterEach(cleanup);

  it("allows deleting a required quantity and replacing it with a single digit", () => {
    const { getByRole, container } = render(<Controlled min={1} max={10} />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "" } });
    expect(input.value).toBe("");
    expect(container.querySelector("output")?.textContent).toBe("invalid");
    expect(validateNumberInputs(container)).toBe(false);
    fireEvent.input(input, { target: { value: "3" } });
    expect(input.value).toBe("3");
    expect(container.querySelector("output")?.textContent).toBe("3");
    expect(validateNumberInputs(container)).toBe(true);
  });

  it("preserves out-of-range text while invalidating the numeric value", () => {
    const { getByRole, container } = render(<Controlled min={1} max={100} />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "123" } });
    expect(input.value).toBe("123");
    expect(container.querySelector("output")?.textContent).toBe("invalid");
    fireEvent.input(input, { target: { value: "12" } });
    expect(container.querySelector("output")?.textContent).toBe("12");
  });

  it("uses explicit fallbacks on blur, after an empty edit invalidates submission", () => {
    const { getByRole, container } = render(<Controlled min={1} emptyFallback={1} />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "" } });
    expect(validateNumberInputs(container)).toBe(false);
    fireEvent.blur(input);
    expect(input.value).toBe("1");
    expect(validateNumberInputs(container)).toBe(true);
  });

  it("keeps optional empty values absent without confusing zero with empty", () => {
    const changed = mock();
    const { getByRole } = render(<NumberInput optional value={2} onOptionalValueChange={changed} />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "" } });
    expect(changed).toHaveBeenLastCalledWith(undefined);
    fireEvent.blur(input);
    fireEvent.input(input, { target: { value: "0" } });
    expect(changed).toHaveBeenLastCalledWith(0);
  });

  it("keeps invalid nonempty optional values invalid", () => {
    const changed = mock();
    const { getByRole } = render(<NumberInput optional min={1} max={5} value={2} onOptionalValueChange={changed} />);
    fireEvent.input(getByRole("spinbutton"), { target: { value: "6" } });
    expect(changed).toHaveBeenLastCalledWith(Number.NaN);
  });

  it("clears an invalid optional draft when its external value is reset", () => {
    function Optional() {
      const [value, setValue] = useState<number | undefined>(2);
      return <><NumberInput optional min={1} max={5} value={value} onOptionalValueChange={setValue} /><button type="button" onClick={() => setValue(undefined)}>Clear</button></>;
    }
    const { getByRole } = render(<Optional />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "99" } });
    expect(input.value).toBe("99");
    fireEvent.click(getByRole("button"));
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("supports decimal and negative values and enforces integer steps", () => {
    const { getByRole, container, unmount } = render(<Controlled step="any" initial={0} />);
    fireEvent.input(getByRole("spinbutton"), { target: { value: "-2.75" } });
    expect(container.querySelector("output")?.textContent).toBe("-2.75");
    expect(getByRole("spinbutton").getAttribute("inputmode")).toBe("decimal");
    unmount();
    const integers = render(<Controlled />);
    fireEvent.input(integers.getByRole("spinbutton"), { target: { value: "2.5" } });
    expect(integers.container.querySelector("output")?.textContent).toBe("invalid");
  });

  it("accepts external resets after invalid edits", () => {
    const { getByRole } = render(<Controlled max={10} />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "99" } });
    fireEvent.click(getByRole("button", { name: "Reset" }));
    expect(input.value).toBe("4");
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });

  it("checks changed bounds before allowing a dialog action", () => {
    const { container, rerender } = render(<NumberInput value={5} max={10} />);
    expect(validateNumberInputs(container)).toBe(true);
    rerender(<NumberInput value={5} max={3} />);
    expect(validateNumberInputs(container)).toBe(false);
  });

  it("blocks Enter callbacks when the native input is invalid", () => {
    const keyDown = mock();
    const { getByRole } = render(<NumberInput value="" onKeyDown={keyDown} />);
    fireEvent.keyDown(getByRole("spinbutton"), { key: "Enter" });
    expect(keyDown).not.toHaveBeenCalled();
  });

  it("supports string-backed values without parsing in callers", () => {
    function StringValue() { const [value, setValue] = useState("1"); return <NumberInput value={value} onTextChange={setValue} />; }
    const { getByRole } = render(<StringValue />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "" } });
    expect(input.value).toBe("");
    fireEvent.input(input, { target: { value: "4" } });
    expect(input.value).toBe("4");
  });

  it("preserves invalid fallback text for optional string-backed values", () => {
    const changed = mock();
    function StringValue() {
      const [value, setValue] = useState("2");
      return (
        <NumberInput
          optional
          min={2}
          value={value}
          onTextChange={(next) => { changed(next); setValue(next); }}
          emptyFallback={1}
        />
      );
    }
    const { getByRole, container } = render(<StringValue />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "" } });
    expect(validateNumberInputs(container)).toBe(true);
    fireEvent.blur(input);
    expect(changed).toHaveBeenLastCalledWith("1");
    expect(input.value).toBe("1");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(validateNumberInputs(container)).toBe(false);
  });

  it("uses the same numeric callback and forwards the original event on fallback", () => {
    const requiredChanged = mock();
    const optionalChanged = mock();
    const onInput = mock();
    const onBlur = mock();
    function OptionalValue() {
      const [value, setValue] = useState<number | undefined>(2);
      return (
        <NumberInput
          optional
          min={2}
          value={value}
          onValueChange={requiredChanged}
          onOptionalValueChange={(next) => { optionalChanged(next); setValue(next); }}
          emptyFallback={1}
          onInput={onInput}
          onBlur={onBlur}
        />
      );
    }
    const { getByRole } = render(<OptionalValue />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "" } });
    expect(optionalChanged).toHaveBeenNthCalledWith(1, undefined);
    fireEvent.blur(input);
    expect(optionalChanged).toHaveBeenNthCalledWith(2, Number.NaN);
    expect(optionalChanged).toHaveBeenCalledTimes(2);
    expect(requiredChanged).not.toHaveBeenCalled();
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onInput.mock.calls[0]?.[0].type).toBe("input");
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(onBlur.mock.calls[0]?.[0].type).toBe("blur");
    expect(input.value).toBe("1");
  });

  it("forwards registered field events and refs without taking over uncontrolled values", async () => {
    const submitted = mock();
    function Registered() { const form = useForm({ defaultValues: { amount: 2 } }); return <form onSubmit={form.handleSubmit(submitted)}><NumberInput {...form.register("amount", { valueAsNumber: true })} /><button type="submit">Save</button></form>; }
    const { getByRole } = render(<Registered />);
    const input = getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("2");
    fireEvent.input(input, { target: { value: "3" } });
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(submitted.mock.calls[0]?.[0]).toEqual({ amount: 3 }));
  });

  it("sends numeric controller values once instead of overwriting them with strings", async () => {
    const submitted = mock();
    function ControlledForm() { const form = useForm({ defaultValues: { amount: 1 } }); return <form onSubmit={form.handleSubmit(submitted)}><Controller control={form.control} name="amount" render={({ field }) => <NumberInput {...field} onValueChange={field.onChange} />} /><button type="submit">Save</button></form>; }
    const { getByRole } = render(<ControlledForm />);
    fireEvent.input(getByRole("spinbutton"), { target: { value: "3" } });
    fireEvent.click(getByRole("button"));
    await waitFor(() => expect(submitted.mock.calls[0]?.[0]).toEqual({ amount: 3 }));
  });
});
