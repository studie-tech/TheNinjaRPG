import { describe, expect, it } from "vitest";
import { scopedRead, withRequestScope } from "@/server/requestScope";

/** A loader that records how many times it actually ran. */
const counted = <T>(value: () => T) => {
  const state = { calls: 0 };
  const load = () => {
    state.calls++;
    return Promise.resolve(value());
  };
  return { state, load };
};

describe("scopedRead", () => {
  it("is a pass-through outside a request scope", async () => {
    const { state, load } = counted(() => ({ n: 1 }));
    await scopedRead("k", load);
    await scopedRead("k", load);
    expect(state.calls).toBe(2);
  });

  it("reads once per key within a request scope", async () => {
    const { state, load } = counted(() => ({ n: 1 }));
    await withRequestScope(async () => {
      await scopedRead("k", load);
      await scopedRead("k", load);
      await scopedRead("k", load);
    });
    expect(state.calls).toBe(1);
  });

  it("collapses concurrent readers onto one in-flight read", async () => {
    const { state, load } = counted(() => ({ n: 1 }));
    await withRequestScope(async () => {
      await Promise.all([
        scopedRead("k", load),
        scopedRead("k", load),
        scopedRead("k", load),
      ]);
    });
    expect(state.calls).toBe(1);
  });

  it("keeps separate keys separate", async () => {
    const { state, load } = counted(() => ({ n: 1 }));
    await withRequestScope(async () => {
      await scopedRead("a", load);
      await scopedRead("b", load);
    });
    expect(state.calls).toBe(2);
  });

  it("does not share the memo between two requests", async () => {
    const { state, load } = counted(() => ({ n: 1 }));
    await withRequestScope(() => scopedRead("k", load));
    await withRequestScope(() => scopedRead("k", load));
    expect(state.calls).toBe(2);
  });

  it("hands every reader its own copy, including the first", async () => {
    const source = { nested: { list: [1, 2, 3] } };
    const { load } = counted(() => source);
    await withRequestScope(async () => {
      const first = await scopedRead("k", load);
      const second = await scopedRead("k", load);
      expect(first).toEqual(source);
      expect(first).not.toBe(second);
      expect(first.nested).not.toBe(second.nested);
      // The memoized value itself must stay pristine for later readers.
      first.nested.list.push(4);
      const third = await scopedRead("k", load);
      expect(third.nested.list).toEqual([1, 2, 3]);
      expect(source.nested.list).toEqual([1, 2, 3]);
    });
  });

  it("preserves dates through the copy", async () => {
    const at = new Date("2024-01-02T03:04:05.000Z");
    await withRequestScope(async () => {
      const read = await scopedRead("k", () => Promise.resolve({ at }));
      expect(read.at).toBeInstanceOf(Date);
      expect(read.at.getTime()).toBe(at.getTime());
    });
  });

  it("memoizes the result of a thenable, not the thenable itself", async () => {
    // A Drizzle query builder is a thenable that runs the statement afresh on every
    // `then`. Memoizing the builder would look like a cache hit while still hitting
    // the database for every reader, which is exactly the bug this guards.
    let executions = 0;
    const builder = {
      then(resolve: (value: { n: number }) => void) {
        executions++;
        resolve({ n: executions });
      },
    };
    await withRequestScope(async () => {
      const first = await scopedRead("k", () => builder as unknown as Promise<{ n: number }>);
      const second = await scopedRead("k", () => builder as unknown as Promise<{ n: number }>);
      expect(first).toEqual({ n: 1 });
      expect(second).toEqual({ n: 1 });
    });
    expect(executions).toBe(1);
  });

  it("rejects every waiter but evicts the failed read so the next one retries", async () => {
    let attempt = 0;
    const load = () => {
      attempt++;
      return attempt === 1
        ? Promise.reject(new Error("connection reset by peer"))
        : Promise.resolve({ n: attempt });
    };
    await withRequestScope(async () => {
      const [a, b] = await Promise.allSettled([
        scopedRead("k", load),
        scopedRead("k", load),
      ]);
      expect(a.status).toBe("rejected");
      expect(b.status).toBe("rejected");
      expect(await scopedRead("k", load)).toEqual({ n: 2 });
    });
    expect(attempt).toBe(2);
  });
});
