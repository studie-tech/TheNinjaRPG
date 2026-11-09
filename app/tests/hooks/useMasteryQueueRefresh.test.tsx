import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useMasteryQueueRefresh } from "@/hooks/useMasteryQueueRefresh";
import type { UserWithRelations } from "@/routers/profile";

const BASE = Date.UTC(2026, 9, 10, 12);
const INTERVAL = 15 * 60_000;
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
  vi.useFakeTimers();
  setSystemTime(BASE);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("global mastery queue refresh", () => {
  it.each(["AWAKE", "ASLEEP"])(
    "refreshes successive queued sessions while %s",
    (status) => {
      const refresh = vi.fn();
      const { rerender } = renderHook(
        ({ user }) => useMasteryQueueRefresh(user, refresh, 0),
        { initialProps: { user: trainee({ status }) } },
      );
      act(() => vi.advanceTimersByTime(INTERVAL - 1));
      expect(refresh).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1_001));
      expect(refresh).toHaveBeenCalledTimes(1);
      rerender({
        user: trainee({
          status,
          currentlyTrainingMastery: "genjutsuMastery",
          masteryTrainingStartedAt: new Date(BASE + INTERVAL),
          masteryQueueHead: 1,
        }),
      });
      act(() => vi.advanceTimersByTime(INTERVAL));
      expect(refresh).toHaveBeenCalledTimes(2);
      rerender({
        user: trainee({
          status,
          currentlyTrainingMastery: "taijutsuMastery",
          masteryTrainingStartedAt: new Date(BASE + 2 * INTERVAL),
          masteryQueueHead: 2,
        }),
      });
      act(() => vi.advanceTimersByTime(INTERVAL * 3));
      // Consumed rows awaiting cleanup must not prevent the final session's refresh.
      expect(refresh).toHaveBeenCalledTimes(3);
    },
  );

  it("uses the server clock and the latest refresh callback", () => {
    const original = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook(
      ({ refresh }) => useMasteryQueueRefresh(trainee(), refresh, 2_000),
      { initialProps: { refresh: original } },
    );
    act(() => vi.advanceTimersByTime(INTERVAL + 1_000));
    expect(original).not.toHaveBeenCalled();
    rerender({ refresh: latest });
    act(() => vi.advanceTimersByTime(2_000));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(original).not.toHaveBeenCalled();
  });

  it("preserves the refresh when another profile render occurs just after the deadline", () => {
    const refresh = vi.fn();
    const { rerender } = renderHook(
      ({ user }) => useMasteryQueueRefresh(user, refresh, 0),
      { initialProps: { user: trainee() } },
    );
    act(() => vi.advanceTimersByTime(INTERVAL + 500));
    rerender({ user: trainee({ curEnergy: 100 }) });
    act(() => vi.advanceTimersByTime(500));
    expect(refresh).toHaveBeenCalledTimes(1);
    // A paused successor keeps the same expired deadline; it must not loop.
    rerender({ user: trainee({ dailyTrainings: 100 }) });
    act(() => vi.advanceTimersByTime(INTERVAL));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    { status: "BATTLE" },
    { status: "HOSPITALIZED" },
    { currentlyTrainingMastery: null, masteryTrainingStartedAt: null },
  ])("does not schedule settlement for an ineligible profile %j", (patch) => {
    const refresh = vi.fn();
    renderHook(() => useMasteryQueueRefresh(trainee(patch), refresh, 0));
    act(() => vi.advanceTimersByTime(INTERVAL * 3));
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([
    { queue: [] },
    { masteryQueueHead: 2 },
    {
      queue: [],
      currentlyTrainingMastery: null,
      masteryTrainingStartedAt: null,
      currentlyTrainingElement: "Wind",
      elementalTrainingStartedAt: new Date(BASE),
      elementalTrainingSpeed: "15min",
    },
  ])("refreshes the final session without live waiting entries %j", (patch) => {
    const refresh = vi.fn();
    renderHook(() => useMasteryQueueRefresh(trainee(patch), refresh, 0));
    act(() => vi.advanceTimersByTime(INTERVAL + 1_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes both standalone sessions in finish order", () => {
    const refresh = vi.fn();
    renderHook(() =>
      useMasteryQueueRefresh(
        trainee({
          queue: [],
          trainingSpeed: "1hr",
          currentlyTrainingElement: "Wind",
          elementalTrainingStartedAt: new Date(BASE),
          elementalTrainingSpeed: "15min",
        }),
        refresh,
        0,
      ),
    );
    act(() => vi.advanceTimersByTime(INTERVAL + 1_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(INTERVAL * 3));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("cancels the deadline when training finishes or the account is disabled", () => {
    const refresh = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ user, enabled }) => useMasteryQueueRefresh(user, refresh, 0, enabled),
      { initialProps: { user: trainee(), enabled: true } },
    );
    rerender({
      user: trainee({ currentlyTrainingMastery: null, masteryTrainingStartedAt: null }),
      enabled: true,
    });
    act(() => vi.advanceTimersByTime(INTERVAL + 1_000));
    expect(refresh).not.toHaveBeenCalled();
    const next = trainee({ masteryTrainingStartedAt: new Date() });
    rerender({ user: next, enabled: true });
    rerender({ user: next, enabled: false });
    act(() => vi.advanceTimersByTime(INTERVAL + 1_000));
    expect(refresh).not.toHaveBeenCalled();
    rerender({
      user: trainee({ masteryTrainingStartedAt: new Date() }),
      enabled: true,
    });
    unmount();
    act(() => vi.advanceTimersByTime(INTERVAL + 1_000));
    expect(refresh).not.toHaveBeenCalled();
  });
});
