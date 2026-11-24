import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { TUTORIAL_STEPS_COUNT, WORLD_CYCLE_SECONDS } from "@/drizzle/constants";
import { useTutorialSky } from "@/hooks/useTutorialSky";
import { getWorldCyclePosition } from "@/libs/dayNight";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

const TIME_DIFF = 5_000;
/** The middle of a night, on this client's clock. */
const NIGHT = WORLD_CYCLE_SECONDS * 1000 * 100.75 + TIME_DIFF;
const student = { tutorialOn: true, tutorialStep: 0 };
let now = NIGHT;

const renderSky = (user: Parameters<typeof useTutorialSky>[0]) => {
  const store = createStore();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return renderHook(({ user }) => useTutorialSky(user, TIME_DIFF), {
    initialProps: { user },
    wrapper,
  });
};

beforeEach(() => {
  installBrowserGlobals();
  now = NIGHT;
  vi.spyOn(Date, "now").mockImplementation(() => now);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("the tutorial's sky", () => {
  it("starts at dawn with cloud shadows, whatever the world's time", () => {
    const { result } = renderSky(student);
    expect(result.current?.weather.kind).toBe("clouds");
    const shown = new Date(now - TIME_DIFF - (result.current?.shiftMs ?? 0));
    expect(getWorldCyclePosition(shown)).toMatchObject({
      phase: "day",
      phaseOffset: 0,
    });
  });

  it("runs on through the lessons rather than starting the morning again", () => {
    const { result, rerender } = renderSky(student);
    const shiftMs = result.current?.shiftMs;
    now += 60_000;
    rerender({ user: { ...student, tutorialStep: 4 } });
    expect(result.current?.shiftMs).toBe(shiftMs);
  });

  it("keeps the morning while the profile loads again", () => {
    const { result, rerender } = renderSky(student);
    const shiftMs = result.current?.shiftMs;
    rerender({ user: undefined as never });
    now += 60_000;
    rerender({ user: student });
    expect(result.current?.shiftMs).toBe(shiftMs);
  });

  it("leaves everyone else under the world's sky", () => {
    for (const user of [
      undefined,
      { tutorialOn: false, tutorialStep: 0 },
      { tutorialOn: true, tutorialStep: TUTORIAL_STEPS_COUNT },
    ])
      expect(renderSky(user).result.current).toBeNull();
  });
});
