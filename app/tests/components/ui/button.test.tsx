import { afterEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  afterEach(cleanup);

  it("blocks repeat presses while loading and marks itself busy", () => {
    const onClick = vi.fn();
    const view = render(
      <Button loading onClick={onClick}>
        Ready
      </Button>,
    );
    const button = view.getByRole("button", { name: "Ready" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("stays pressable when idle", () => {
    const onClick = vi.fn();
    const view = render(<Button onClick={onClick}>Ready</Button>);
    const button = view.getByRole("button", { name: "Ready" });
    expect(button.hasAttribute("aria-busy")).toBe(false);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("only pulses an enabled call to action", () => {
    const view = render(
      <>
        <Button animation="pulse">Claim</Button>
        <Button animation="pulse" disabled>
          Locked
        </Button>
      </>,
    );
    expect(view.getByRole("button", { name: "Claim" }).className).toContain(
      "animate-cta-pulse",
    );
    expect(view.getByRole("button", { name: "Locked" }).className).not.toContain(
      "animate-cta-pulse",
    );
  });

  it("sizes a decorated button's wrapper with its responsive width and alignment", () => {
    const view = render(
      <Button decoration="gold" className="w-full sm:w-auto self-start px-4">
        Begin
      </Button>,
    );
    const wrapper = view.getByRole("button", { name: "Begin" }).parentElement;
    expect(wrapper?.className).toContain("w-full");
    expect(wrapper?.className).toContain("sm:w-auto");
    expect(wrapper?.className).toContain("self-start");
    expect(wrapper?.className).not.toContain("px-4");
  });

  it("pins the count to the top right corner, also on a slotted button", () => {
    const view = render(
      <>
        <Button count={3}>Filter</Button>
        <Button asChild count={12}>
          <a href="/missions">Missions</a>
        </Button>
        <Button count={0}>Empty</Button>
      </>,
    );
    for (const count of ["3", "12"]) {
      const classes = view.getByText(count).className.split(" ");
      expect(classes).toEqual(
        expect.arrayContaining(["absolute", "-top-1.5", "-right-1.5", "min-w-5"]),
      );
      expect(classes).toContain("pointer-events-none");
    }
    expect(view.queryByText("0")).toBeNull();
  });
});
