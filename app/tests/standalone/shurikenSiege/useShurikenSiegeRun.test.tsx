import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ShurikenSiegeStore } from "@/standalone/shurikenSiege/portal";
import { useShurikenSiegeRun } from "@/standalone/shurikenSiege/useShurikenSiegeRun";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  restoreBrowserGlobals();
});

const SAVE = JSON.stringify({ points: 50, bestWave: 30, dojo: { dmg: 1 } });

/** A cloud-like store whose first `goodReads` reads succeed and whose later reads fail. */
const flakyStore = (goodReads = 1) => {
  let reads = 0;
  const store: ShurikenSiegeStore = {
    read: vi.fn(async () => {
      reads++;
      if (reads > goodReads) throw new Error("offline");
      return SAVE;
    }),
    write: vi.fn(async () => true),
    saveRuns: false,
  };
  return store;
};

describe("useShurikenSiegeRun", () => {
  it("writes nothing after a fresh read of the save fails", async () => {
    const store = flakyStore();
    const { result } = renderHook(() => useShurikenSiegeRun(store));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.progress).toEqual({
      points: 50,
      bestWave: 30,
      dojo: { dmg: 1 },
    });

    await act(async () => {
      await result.current.buyDojo("rate");
    });
    expect(store.write).not.toHaveBeenCalled();
    // The shown progress stays what was last read.
    expect(result.current.progress.points).toBe(50);

    // A run ending now is kept for another try instead of banked over the save.
    await act(async () => {
      await result.current.start(1);
    });
    expect(result.current.phase).toBe("lobby");
    expect(store.write).not.toHaveBeenCalled();
  });

  it("keeps a finished run for another try when the save cannot be read to bank it", async () => {
    // The initial read and the run's start succeed; the read for banking fails.
    const store = flakyStore(2);
    const { result } = renderHook(() => useShurikenSiegeRun(store));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    await act(async () => {
      await result.current.start(1);
    });
    expect(result.current.phase).toBe("playing");
    await act(async () => {
      result.current.act(["quit"]);
    });
    await waitFor(() => expect(result.current.phase).toBe("over"));
    expect(store.write).not.toHaveBeenCalled();
    expect(result.current.outcome).toEqual(
      expect.objectContaining({ claimed: false, retryable: true }),
    );
  });
});
