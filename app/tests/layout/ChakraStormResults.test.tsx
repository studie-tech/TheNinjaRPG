import { afterEach, beforeEach, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { ChakraStormOutcome } from "@/hooks/useChakraStormRun";
import { ChakraStormResults } from "@/layout/ChakraStormHud";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => installBrowserGlobals());
afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
});

/** A won Horizon run that went past the ten minutes that open the next region. */
const outcome = (overrides: Partial<ChakraStormOutcome>): ChakraStormOutcome => ({
  stage: "horizon",
  seconds: 900,
  kills: 12_000,
  level: 62,
  won: true,
  bosses: 3,
  intel: 0,
  isBest: false,
  claim: "failed",
  ...overrides,
});

const show = (value: ChakraStormOutcome) =>
  render(
    <ChakraStormResults
      outcome={value}
      goal={{ stage: "akasumi", seconds: 600 }}
      onAgain={() => {}}
      onScout={() => {}}
      onLeave={() => {}}
      onRetry={() => {}}
    />,
  );

it("explains why a claim is unconfirmed and how to retry", () => {
  const view = show(
    outcome({
      message: "Chakra Storm rewards are temporarily paused.",
      retryable: true,
    }),
  );
  expect(view.getByText("Intel and region progress not confirmed")).toBeTruthy();
  expect(view.getByText("Chakra Storm rewards are temporarily paused.")).toBeTruthy();
  expect(view.getByText(/Try again before leaving this screen/)).toBeTruthy();
  expect(view.getByRole("button", { name: /Try again/ })).toBeTruthy();
  expect(view.queryByText(/report delivered/)).toBeNull();
  expect(view.getByText("Scouting complete")).toBeTruthy();
});

it("explains a refusal for good without offering a retry", () => {
  const view = show(
    outcome({ message: "This run's token is invalid.", retryable: false, won: false }),
  );
  expect(view.getByText("Intel and region progress not confirmed")).toBeTruthy();
  expect(view.getByText(/Only runs the server verifies earn intel/)).toBeTruthy();
  expect(view.queryByRole("button", { name: /^Try again$/ })).toBeNull();
});

it.each([false, true])(
  "does not report lost progress after a transport failure (challenge: %s)",
  (challenge) => {
    const message =
      "We could not reach the server to verify this run. Keep this tab open and try again.";
    const view = show(
      outcome({
        message,
        retryable: true,
        challenge: challenge ? { questId: "quest", objectiveId: "storm" } : undefined,
      }),
    );
    expect(
      view.getByText(
        challenge
          ? "Run result not confirmed"
          : "Intel and region progress not confirmed",
      ),
    ).toBeTruthy();
    expect(view.getByText(message)).toBeTruthy();
    expect(view.getByRole("button", { name: /^Try again$/ })).toBeTruthy();
    expect(
      view.queryByText(/not recorded|No intel or region progress saved/),
    ).toBeNull();
  },
);

it("shows the intel of a paid run", () => {
  const view = show(outcome({ claim: "paid", intel: 1_730, unlocked: "akasumi" }));
  expect(view.getByText(/1,730/)).toBeTruthy();
  expect(view.getByText("Scouting complete: report delivered!")).toBeTruthy();
  expect(view.queryByText("Intel and region progress not confirmed")).toBeNull();
});
