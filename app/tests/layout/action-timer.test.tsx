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

const lobbyBattle = () => {
  const now = Date.now();
  return makeCompleteBattle({
    usersState: [
      makeBattleUser("p1", { curHealth: 100 }),
      makeBattleUser("p2", { curHealth: 100 }),
    ],
    activeUserId: "p1",
    roundStartAt: new Date(now + 60_000),
    version: 1,
  });
};

const countdownBattle = () => {
  const now = Date.now();
  return makeCompleteBattle({
    usersState: [
      makeBattleUser("p1", { curHealth: 100 }),
      makeBattleUser("p2", { curHealth: 100 }),
    ],
    activeUserId: "p1",
    roundStartAt: new Date(now - 1000),
    version: 1,
  });
};

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
  return { commits: () => commits, getByText: view.getByText };
};

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ActionTimer interval commits", () => {
  it("does not re-commit when the timer label and flags stay the same", () => {
    vi.useFakeTimers();
    const { commits, getByText } = renderTimer(lobbyBattle());
    expect(getByText("Lobby")).toBeTruthy();
    const afterMount = commits();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // 20 interval ticks. A stray child rAF/layout commit is fine; a commit per tick is not.
    expect(commits() - afterMount).toBeLessThan(5);
    expect(getByText("Lobby")).toBeTruthy();
  });

  it("re-commits when the displayed tenth-second label changes", () => {
    vi.useFakeTimers();
    const { commits, getByText } = renderTimer(countdownBattle());
    expect(getByText(`You: ${(COMBAT_SECONDS - 1).toFixed(1)}s`)).toBeTruthy();
    const afterMount = commits();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(commits()).toBeGreaterThan(afterMount);
    expect(getByText(`You: ${(COMBAT_SECONDS - 1.1).toFixed(1)}s`)).toBeTruthy();
  });
});
