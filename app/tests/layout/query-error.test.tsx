import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "bun:test";
import { QueryError } from "@/layout/QueryError";

afterEach(cleanup);

describe("QueryError", () => {
  it.each(["inline", "stacked", "panel"] as const)(
    "announces the %s failure and retries from its button",
    (layout) => {
      const onRetry = vi.fn();
      render(
        <QueryError
          layout={layout}
          message="Unable to load."
          retryLabel="Retry"
          onRetry={onRetry}
        />,
      );
      expect(screen.getByRole("alert").textContent).toContain("Unable to load.");
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(onRetry).toHaveBeenCalledTimes(1);
    },
  );

  it("offers Try again by default, inline with the message", () => {
    render(<QueryError message="Unable to load." onRetry={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toBe("Unable to load. Try again");
  });

  it("disables the control while retrying", () => {
    render(
      <QueryError message="Unable to load." onRetry={() => undefined} isRetrying />,
    );
    expect(screen.getByRole<HTMLButtonElement>("button").disabled).toBe(true);
  });

  it("puts stacked messages in their own styled block", () => {
    render(
      <QueryError
        layout="stacked"
        message="Unable to load."
        messageClassName="mb-3"
        className="space-y-2"
        onRetry={() => undefined}
      />,
    );
    expect(screen.getByRole("alert").className).toBe("space-y-2");
    expect(screen.getByText("Unable to load.").className).toBe("mb-3");
  });
});
