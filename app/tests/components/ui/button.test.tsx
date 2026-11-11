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
});
