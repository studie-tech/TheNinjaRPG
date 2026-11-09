import { describe, expect, it, vi } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { usePendingIds } from "@/hooks/usePendingIds";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import { deferred } from "../setup/deferred";

describe("useSingleFlight", () => {
  it("refuses a second submission in the same tick, before pending renders", async () => {
    const { result } = renderHook(() => useSingleFlight<{ id: string }>());
    const flight = deferred<string>();
    const first = vi.fn(() => flight.promise);
    const second = vi.fn(async () => "duplicate");

    let firstRun!: Promise<string | undefined>;
    let secondRun!: Promise<string | undefined>;
    act(() => {
      // Both come from one render's handler, so neither can see a pending state yet.
      const { run } = result.current;
      firstRun = run({ id: "a" }, first);
      secondRun = run({ id: "b" }, second);
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(await secondRun).toBeUndefined();
    expect(result.current.pending).toEqual({ id: "a" });
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      flight.resolve("done");
      expect(await firstRun).toBe("done");
    });
    expect(result.current.pending).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  it("releases after a failure, passes the error on and accepts a retry", async () => {
    const { result } = renderHook(() => useSingleFlight());
    const failure = new Error("offline");

    await act(async () => {
      await expect(
        result.current.run(true, async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
    });

    expect(result.current.isPending).toBe(false);
    expect(result.current.current()).toBeNull();
    let retried: string | undefined;
    await act(async () => {
      retried = await result.current.run(true, async () => "retried");
    });
    expect(retried).toBe("retried");
  });

  it("keeps a mutate-style flight held until it is released", () => {
    const { result } = renderHook(() => useSingleFlight());
    let claimed = false;
    let duplicate = true;
    act(() => {
      const { claim } = result.current;
      claimed = claim();
      duplicate = claim();
    });
    expect(claimed).toBe(true);
    expect(duplicate).toBe(false);
    expect(result.current.current()).toBe(true);
    act(() => result.current.release());
    expect(result.current.current()).toBeNull();
  });

  it("lets an abandoned flight's late response see it lost ownership", async () => {
    const { result } = renderHook(() => useSingleFlight<{ id: string }>());
    const abandoned = { id: "old" };
    const next = { id: "new" };
    const flight = deferred<void>();
    let stillOwned: boolean | undefined;

    let run!: Promise<void>;
    act(() => {
      run = (async () => {
        await result.current.run(abandoned, async () => {
          await flight.promise;
          stillOwned = result.current.owns(abandoned);
        });
      })();
    });
    act(() => result.current.release());
    act(() => {
      result.current.claim(next);
    });

    await act(async () => {
      flight.resolve();
      await run;
    });
    expect(stillOwned).toBe(false);
    // The abandoned task's own release must not free its successor.
    expect(result.current.current()).toBe(next);
    expect(result.current.pending).toBe(next);
  });
});

describe("usePendingIds", () => {
  it("guards each id on its own, synchronously", () => {
    const { result } = renderHook(() => usePendingIds());
    const begun: boolean[] = [];
    act(() => {
      const { begin } = result.current;
      begun.push(begin("a"), begin("a"), begin("b"));
    });
    expect(begun).toEqual([true, false, true]);
    expect([...result.current.ids]).toEqual(["a", "b"]);
    expect(result.current.has("a")).toBe(true);

    act(() => result.current.end("a"));
    expect([...result.current.ids]).toEqual(["b"]);
    expect(result.current.has("a")).toBe(false);
    expect(result.current.has("b")).toBe(true);

    let again = false;
    act(() => {
      again = result.current.begin("a");
    });
    expect(again).toBe(true);
  });
});
