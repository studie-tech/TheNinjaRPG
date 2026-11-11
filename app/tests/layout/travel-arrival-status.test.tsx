import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { TravelArrivalStatus } from "@/layout/TravelArrivalStatus";

const BASE = Date.UTC(2026, 10, 10, 12);
let now = BASE;

beforeEach(() => {
  now = BASE;
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("shows the destination and server-adjusted timer, then requests arrival once", () => {
  const onArrive = vi.fn();
  const view = render(
    <StrictMode>
      <TravelArrivalStatus
        sector={222}
        destinationName="Wake Island"
        finishAt={new Date(BASE + 2000)}
        timeDiff={1000}
        isBusy={false}
        isArrivalRejected={false}
        onArrive={onArrive}
      />
    </StrictMode>,
  );
  expect(view.getByText("Wake Island")).toBeTruthy();
  expect(view.getByText("Sector 222")).toBeTruthy();
  expect(view.getByText("3s remaining")).toBeTruthy();
  now += 2000;
  act(() => vi.advanceTimersByTime(2000));
  expect(onArrive).not.toHaveBeenCalled();
  now += 1000;
  act(() => vi.advanceTimersByTime(1000));
  expect(view.getByText("Arriving…")).toBeTruthy();
  expect(onArrive).toHaveBeenCalledTimes(1);
});

it("waits for admission to finish and allows a rejected arrival to be retried", () => {
  const onArrive = vi.fn();
  const props = {
    sector: 177,
    finishAt: new Date(BASE - 1),
    timeDiff: 0,
    isBusy: true,
    isArrivalRejected: false,
    onArrive,
  };
  const view = render(<TravelArrivalStatus {...props} />);
  expect(view.getByText("Sector 177")).toBeTruthy();
  expect(onArrive).not.toHaveBeenCalled();
  view.rerender(<TravelArrivalStatus {...props} isBusy={false} />);
  expect(onArrive).toHaveBeenCalledTimes(1);
  view.rerender(<TravelArrivalStatus {...props} isBusy={false} isArrivalRejected />);
  expect(view.getByRole("alert").textContent).toContain("Please try again");
  expect(onArrive).toHaveBeenCalledTimes(1);
  fireEvent.click(view.getByRole("button", { name: "Retry arrival" }));
  expect(onArrive).toHaveBeenCalledTimes(2);
  view.rerender(<TravelArrivalStatus {...props} />);
  expect(onArrive).toHaveBeenCalledTimes(2);
});

it("waits for a corrected server deadline when admission outlasts the optimistic timer", () => {
  const onArrive = vi.fn();
  const props = {
    sector: 227,
    finishAt: new Date(BASE - 1),
    timeDiff: 0,
    isBusy: true,
    isArrivalRejected: false,
    onArrive,
  };
  const view = render(<TravelArrivalStatus {...props} />);
  view.rerender(
    <TravelArrivalStatus {...props} finishAt={new Date(BASE + 2000)} isBusy={false} />,
  );
  expect(onArrive).not.toHaveBeenCalled();
  expect(view.getByText("2s remaining")).toBeTruthy();
  now += 2000;
  act(() => vi.advanceTimersByTime(2000));
  expect(onArrive).toHaveBeenCalledTimes(1);
});
