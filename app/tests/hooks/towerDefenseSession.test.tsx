import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  type TowerDefenseBackend,
  useTowerDefenseSession,
} from "@/hooks/useTowerDefenseSession";
import { readSavedRunHead } from "@/libs/towerDefense/savedRun";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  restoreBrowserGlobals();
});

const STORAGE_KEY = "towerDefenseRun:session-test";

const fakeBackend = (token: string | null): TowerDefenseBackend => ({
  storageKey: STORAGE_KEY,
  isStarting: false,
  startRun: vi.fn(async (startWave: number) => ({
    config: { seed: "session", startWave, bestWave: 0, level: 1, dojo: {} },
    token,
  })),
  claimRun: vi.fn(async () => ({
    settled: true,
    claimed: true,
    retryable: false,
    reloadRequired: false,
    points: 7,
    message: "Banked",
  })),
});

describe("useTowerDefenseSession", () => {
  it("saves a tokened run and settles it through its backend", async () => {
    const backend = fakeBackend("token-1");
    const { result } = renderHook(() => useTowerDefenseSession(backend));
    await act(async () => {
      await result.current.start(1);
    });
    expect(backend.startRun).toHaveBeenCalledWith(1);
    expect(result.current.phase).toBe("playing");
    expect(readSavedRunHead(STORAGE_KEY)?.token).toBe("token-1");

    await act(async () => {
      result.current.act(["quit"]);
      await Promise.resolve();
    });
    expect(backend.claimRun).toHaveBeenCalledWith(
      expect.objectContaining({ token: "token-1", unsaved: false }),
    );
    expect(result.current.phase).toBe("over");
    expect(result.current.outcome).toEqual(
      expect.objectContaining({
        claimed: true,
        points: 7,
        message: "Banked",
        quit: true,
      }),
    );
    // A settled run leaves no save behind.
    expect(readSavedRunHead(STORAGE_KEY)).toBeNull();
  });

  it("keeps a host pause through a new run and refuses commands until it ends", async () => {
    const backend: TowerDefenseBackend = {
      ...fakeBackend("token-host"),
      // A run with the Guard Hall speed upgrade, so a faster speed is allowed.
      startRun: vi.fn(async (startWave: number) => ({
        config: {
          seed: "session",
          startWave,
          bestWave: 0,
          level: 1,
          dojo: { speed: 2 },
        },
        token: "token-host",
      })),
    };
    const { result } = renderHook(() => useTowerDefenseSession(backend));
    act(() => {
      result.current.setPaused("host", true);
      result.current.setPaused("player", true);
    });
    await act(async () => {
      await result.current.start(1);
    });
    expect(result.current.pauses).toEqual(["host"]);
    let accepted = true;
    act(() => {
      accepted = result.current.act(["quit"]);
    });
    expect(accepted).toBe(false);
    expect(backend.claimRun).not.toHaveBeenCalled();
    // The player's controls cannot pause or speed up the run the host holds.
    act(() => {
      result.current.setPaused("player", true);
      result.current.setSpeed(2);
    });
    expect(result.current.pauses).toEqual(["host"]);
    expect(result.current.speed).toBe(1);

    act(() => {
      result.current.setPaused("host", false);
    });
    expect(result.current.pauses).toEqual([]);
    act(() => {
      result.current.setSpeed(2);
    });
    expect(result.current.speed).toBe(2);
    await act(async () => {
      result.current.act(["quit"]);
      await Promise.resolve();
    });
    expect(backend.claimRun).toHaveBeenCalled();
  });

  it("plays a run without a token locally, never saving or claiming it", async () => {
    const backend = fakeBackend(null);
    const { result } = renderHook(() => useTowerDefenseSession(backend));
    await act(async () => {
      await result.current.start(1);
    });
    expect(readSavedRunHead(STORAGE_KEY)).toBeNull();
    await act(async () => {
      result.current.act(["quit"]);
      await Promise.resolve();
    });
    expect(backend.claimRun).not.toHaveBeenCalled();
    expect(result.current.outcome).toEqual(
      expect.objectContaining({ claimed: false, retryable: false }),
    );
  });

  it("claims runs but neither keeps nor offers device saves when saveRuns is off", async () => {
    // A run left on the device by a build that keeps them.
    const keeper = renderHook(() => useTowerDefenseSession(fakeBackend("token-old")));
    await act(async () => {
      await keeper.result.current.start(1);
    });
    keeper.unmount();
    expect(readSavedRunHead(STORAGE_KEY)?.token).toBe("token-old");

    const backend = { ...fakeBackend("token-2"), saveRuns: false };
    const { result } = renderHook(() => useTowerDefenseSession(backend));
    expect(result.current.saved).toBeNull();
    await act(async () => {
      await result.current.start(1);
    });
    expect(readSavedRunHead(STORAGE_KEY)?.token).toBe("token-old");
    await act(async () => {
      result.current.act(["quit"]);
      await Promise.resolve();
    });
    expect(backend.claimRun).toHaveBeenCalledWith(
      expect.objectContaining({ token: "token-2" }),
    );
    // Settling the claimed run leaves the other build's save alone.
    expect(result.current.phase).toBe("over");
    expect(readSavedRunHead(STORAGE_KEY)?.token).toBe("token-old");
  });
});
