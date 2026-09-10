import { ensureDom } from "../setup-dom.mjs";
import { act, cleanup, render } from "@testing-library/react";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActionTimer from "@/layout/ActionTimer";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import {
  makeBattleUser,
  makeCompleteBattle,
} from "../libs/combat/helpers/battleScenario";

ensureDom();

vi.mock("@/utils/UserContext", () => ({
  useUserData: () => ({ timeDiff: 0 }),
}));

const FROZEN_NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
let nowMs = FROZEN_NOW;

const advanceTimers = (ms: number) => {
  nowMs += ms;
  vi.advanceTimersByTime(ms);
};

const lobbyBattle = () =>
  makeCompleteBattle({
    usersState: [
      makeBattleUser("p1", { curHealth: 100 }),
      makeBattleUser("p2", { curHealth: 100 }),
    ],
    activeUserId: "p1",
    roundStartAt: new Date(FROZEN_NOW + 60_000),
    version: 1,
  });

const countdownBattle = () =>
  makeCompleteBattle({
    usersState: [
      makeBattleUser("p1", { curHealth: 100 }),
      makeBattleUser("p2", { curHealth: 100 }),
    ],
    activeUserId: "p1",
    roundStartAt: new Date(FROZEN_NOW - 1000),
    version: 1,
  });

const renderTimer = (battle: ReturnType<typeof makeCompleteBattle>) => {
  let commits = 0;
  const onRender: ProfilerOnRenderCallback = () => {
    commits += 1;
  };
  const view = render(
    <Profiler id="action-timer" onRender={onRender}>
      <ActionTimer
        user={{ userId: "p1", actionPoints: 100 }}
        battle={battle}
        isPending={false}
      />
    </Profiler>,
  );
  return {
    commits: () => commits,
    getByText: view.getByText,
    queryByText: view.queryByText,
  };
};

const flushMount = () => {
  act(() => {
    vi.advanceTimersByTime(0);
  });
};

beforeEach(() => {
  nowMs = FROZEN_NOW;
  vi.useFakeTimers();
  vi.spyOn(Date, "now").mockImplementation(() => nowMs);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ActionTimer interval commits", () => {
  it("does not paint the ellipsis fallback after the first timer state", () => {
    const { queryByText, getByText } = renderTimer(lobbyBattle());
    expect(queryByText("...")).toBeNull();
    expect(getByText("Lobby")).toBeTruthy();
  });

  it("does not re-commit when the timer label and flags stay the same", () => {
    const { commits, getByText } = renderTimer(lobbyBattle());
    flushMount();
    expect(getByText("Lobby")).toBeTruthy();
    const afterMount = commits();

    act(() => {
      advanceTimers(2000);
    });

    expect(commits() - afterMount).toBe(0);
    expect(getByText("Lobby")).toBeTruthy();
  });

  it("does not re-commit while the tab is unfocused", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { commits, getByText } = renderTimer(lobbyBattle());
    flushMount();
    expect(getByText("Not in Focus")).toBeTruthy();
    const afterMount = commits();

    act(() => {
      advanceTimers(2000);
    });

    expect(commits() - afterMount).toBe(0);
    expect(getByText("Not in Focus")).toBeTruthy();
  });

  it("re-commits when the displayed tenth-second label changes", () => {
    const { commits, getByText } = renderTimer(countdownBattle());
    flushMount();
    expect(getByText(`You: ${(COMBAT_SECONDS - 1).toFixed(1)}s`)).toBeTruthy();
    const afterMount = commits();

    act(() => {
      advanceTimers(100);
    });

    expect(commits()).toBeGreaterThan(afterMount);
    expect(getByText(`You: ${(COMBAT_SECONDS - 1.1).toFixed(1)}s`)).toBeTruthy();
  });
});
