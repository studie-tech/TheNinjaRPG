import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  setSystemTime,
  vi,
} from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import ActionTimer, { formatSecondsLeft } from "@/layout/ActionTimer";
import { COMBAT_SECONDS } from "@/libs/combat/constants";
import * as userContext from "@/utils/UserContext";
import { makeBattleUser, makeCompleteBattle } from "../setup/combat";

const FROZEN_NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
let isHidden = false;

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

const countdownBattle = (elapsedMs = 1000) =>
  makeCompleteBattle({
    usersState: [
      makeBattleUser("p1", { curHealth: 100 }),
      makeBattleUser("p2", { curHealth: 100 }),
    ],
    activeUserId: "p1",
    roundStartAt: new Date(FROZEN_NOW - elapsedMs),
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
    getAllByText: view.getAllByText,
    queryByText: view.queryByText,
  };
};

const flushMount = () => {
  act(() => {
    vi.advanceTimersByTime(0);
  });
};

beforeEach(() => {
  vi.spyOn(userContext, "useUserData").mockReturnValue({ timeDiff: 0 } as never);
  vi.useFakeTimers();
  setSystemTime(FROZEN_NOW);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  isHidden = false;
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => isHidden,
  });
});

afterEach(() => {
  cleanup();
  delete (document as unknown as { hidden?: boolean }).hidden;
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
      vi.advanceTimersByTime(2000);
    });

    expect(commits() - afterMount).toBe(0);
    expect(getByText("Lobby")).toBeTruthy();
  });

  it("keeps a visible battle timer running without window focus", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    const { getByText, queryByText } = renderTimer(countdownBattle());
    expect(queryByText("Not in Focus")).toBeNull();
    act(() => vi.advanceTimersByTime(100));
    expect(getByText(`You: ${formatSecondsLeft(COMBAT_SECONDS - 1.1)}s`)).toBeTruthy();
  });

  it("pauses hidden timers and catches up when visible again", () => {
    const { commits, getByText } = renderTimer(countdownBattle());
    act(() => {
      isHidden = true;
      document.dispatchEvent(new window.Event("visibilitychange"));
    });
    const afterHide = commits();
    act(() => vi.advanceTimersByTime(2000));
    expect(commits()).toBe(afterHide);
    act(() => {
      isHidden = false;
      document.dispatchEvent(new window.Event("visibilitychange"));
    });
    expect(getByText(`You: ${formatSecondsLeft(COMBAT_SECONDS - 3)}s`)).toBeTruthy();
  });

  it("shows whole seconds and re-commits only when the second changes", () => {
    const { commits, getByText } = renderTimer(countdownBattle());
    flushMount();
    expect(getByText(`You: ${COMBAT_SECONDS - 1}s`)).toBeTruthy();
    const afterMount = commits();

    act(() => vi.advanceTimersByTime(900));
    expect(commits()).toBe(afterMount);

    act(() => vi.advanceTimersByTime(100));
    expect(commits()).toBeGreaterThan(afterMount);
    expect(getByText(`You: ${COMBAT_SECONDS - 2}s`)).toBeTruthy();
  });

  it("shows tenths of a second near the end of the turn", () => {
    const { commits, getByText } = renderTimer(
      countdownBattle((COMBAT_SECONDS - 5) * 1000),
    );
    flushMount();
    expect(getByText("You: 5.0s")).toBeTruthy();
    const afterMount = commits();

    act(() => vi.advanceTimersByTime(100));
    expect(commits()).toBeGreaterThan(afterMount);
    expect(getByText("You: 4.9s")).toBeTruthy();
  });
});

describe("formatSecondsLeft", () => {
  it("rounds up to whole seconds above the precise window", () => {
    expect(formatSecondsLeft(58.1)).toBe("59");
    expect(formatSecondsLeft(10.01)).toBe("11");
    expect(formatSecondsLeft(10)).toBe("10.0");
    expect(formatSecondsLeft(0.25)).toBe("0.3");
  });
});

describe("ActionTimer turn label", () => {
  const teamBattle = (activeUserId: string) =>
    makeCompleteBattle({
      usersState: [
        makeBattleUser("p1", { curHealth: 100, direction: "left" }),
        makeBattleUser("ally", { curHealth: 100, direction: "left" }),
        makeBattleUser("enemy", { curHealth: 100, direction: "right" }),
      ],
      activeUserId,
      roundStartAt: new Date(FROZEN_NOW - 1000),
      version: 1,
    });
  const label = `${formatSecondsLeft(COMBAT_SECONDS - 1.1)}s`;

  it("names a teammate's turn as the ally's", () => {
    const { getByText, queryByText } = renderTimer(teamBattle("ally"));
    act(() => vi.advanceTimersByTime(100));
    expect(getByText(`Ally: ${label}`)).toBeTruthy();
    expect(queryByText(`Opponent: ${label}`)).toBeNull();
  });

  it("names the other team's turn as the opponent's", () => {
    const { getAllByText } = renderTimer(teamBattle("enemy"));
    act(() => vi.advanceTimersByTime(100));
    expect(getAllByText(`Opponent: ${label}`).length).toBeGreaterThan(0);
  });
});
