import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { useMasteryQueueRefresh } from "@/hooks/useMasteryQueueRefresh";
import type { UserWithRelations } from "@/routers/profile";
import { ensureDom } from "../setup-dom.mjs";

ensureDom();

const BASE = Date.UTC(2026, 9, 10, 12);
const INTERVAL = 15 * 60_000;
let nowMs = BASE;
const advanceTimers = (ms: number) => {
  nowMs += ms;
  vi.advanceTimersByTime(ms);
};
const trainee = (patch: Record<string, unknown> = {}) =>
  ({
    status: "ASLEEP",
    trainingSpeed: "15min",
    currentlyTrainingMastery: "ninjutsuMastery",
    masteryTrainingStartedAt: new Date(BASE),
    energyQueueHead: 0,
    masteryQueueHead: 0,
    queue: [
      { kind: "MASTERY", position: 1, stat: "genjutsuMastery", speed: "15min" },
      { kind: "MASTERY", position: 2, stat: "taijutsuMastery", speed: "15min" },
    ],
    ...patch,
  }) as NonNullable<UserWithRelations>;

beforeEach(() => {
  nowMs = BASE;
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => nowMs);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("global mastery queue refresh", () => {
  it.each(["AWAKE", "ASLEEP"])("refreshes successive queued sessions while %s", (status) => {
    const refresh = vi.fn();
    const { rerender } = renderHook(
      ({ user }) => useMasteryQueueRefresh(user, refresh, 0),
      { initialProps: { user: trainee({ status }) } },
    );
    act(() => advanceTimers(INTERVAL - 1));
    expect(refresh).not.toHaveBeenCalled();
    act(() => advanceTimers(1_001));
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ user: trainee({ status, currentlyTrainingMastery: "genjutsuMastery", masteryTrainingStartedAt: new Date(BASE + INTERVAL), masteryQueueHead: 1 }) });
    act(() => advanceTimers(INTERVAL));
    expect(refresh).toHaveBeenCalledTimes(2);
    rerender({ user: trainee({ status, currentlyTrainingMastery: "taijutsuMastery", masteryTrainingStartedAt: new Date(BASE + 2 * INTERVAL), masteryQueueHead: 2 }) });
    act(() => advanceTimers(INTERVAL * 3));
    // Consumed rows awaiting cleanup must not automatically collect the final session.
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("uses the server clock and the latest refresh callback", () => {
    const original = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook(
      ({ refresh }) => useMasteryQueueRefresh(trainee(), refresh, 2_000),
      { initialProps: { refresh: original } },
    );
    act(() => advanceTimers(INTERVAL + 1_000));
    expect(original).not.toHaveBeenCalled();
    rerender({ refresh: latest });
    act(() => advanceTimers(2_000));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(original).not.toHaveBeenCalled();
  });

  it("preserves the refresh when another profile render occurs just after the deadline", () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(
      ({ user }) => useMasteryQueueRefresh(user, refresh, 0),
      { initialProps: { user: trainee() } },
    );
    act(() => advanceTimers(INTERVAL + 500));
    rerender({ user: trainee({ curEnergy: 100 }) });
    act(() => advanceTimers(500));
    expect(refresh).toHaveBeenCalledTimes(1);
    // A paused successor keeps the same expired deadline; it must not loop.
    rerender({ user: trainee({ dailyTrainings: 100 }) });
    act(() => advanceTimers(INTERVAL));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: "BATTLE" },
    { status: "HOSPITALIZED" },
    { currentlyTrainingMastery: null, masteryTrainingStartedAt: null },
    { queue: [] },
    { masteryQueueHead: 2 },
  ])("does not schedule settlement for an ineligible profile %j", (patch) => {
    const refresh = vi.fn();
    renderHook(() => useMasteryQueueRefresh(trainee(patch), refresh, 0));
    act(() => advanceTimers(INTERVAL * 3));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cancels the deadline when the queue is removed or the account is disabled", () => {
    const refresh = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ user, enabled }) => useMasteryQueueRefresh(user, refresh, 0, enabled),
      { initialProps: { user: trainee(), enabled: true } },
    );
    rerender({ user: trainee({ queue: [] }), enabled: true });
    act(() => advanceTimers(INTERVAL + 1_000));
    expect(refresh).not.toHaveBeenCalled();
    const next = trainee({ masteryTrainingStartedAt: new Date(nowMs) });
    rerender({ user: next, enabled: true });
    rerender({ user: next, enabled: false });
    act(() => advanceTimers(INTERVAL + 1_000));
    expect(refresh).not.toHaveBeenCalled();
    rerender({ user: trainee({ masteryTrainingStartedAt: new Date(nowMs) }), enabled: true });
    unmount();
    act(() => advanceTimers(INTERVAL + 1_000));
    expect(refresh).not.toHaveBeenCalled();
  });
});
