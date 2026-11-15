import { describe, expect, it, vi } from "bun:test";
import { createRecyclePool } from "@/libs/rendering/recyclePool";

describe("recycle pool", () => {
  it("hands back released items before reporting empty", () => {
    const pool = createRecyclePool<{ id: number }>({ limit: 4, dispose: vi.fn() });
    expect(pool.take()).toBeUndefined();
    const first = { id: 1 },
      second = { id: 2 };
    pool.release(first);
    pool.release(second);
    expect(pool.size()).toBe(2);
    expect(pool.take()).toBe(second);
    expect(pool.take()).toBe(first);
    expect(pool.take()).toBeUndefined();
  });

  it("disposes releases beyond its limit and everything it keeps on disposal", () => {
    const dispose = vi.fn();
    const pool = createRecyclePool<number>({ limit: 2, dispose });
    for (const item of [1, 2, 3]) pool.release(item);
    expect(dispose.mock.calls).toEqual([[3]]);
    pool.dispose();
    expect(dispose.mock.calls).toEqual([[3], [1], [2]]);
    expect(pool.size()).toBe(0);
    expect(pool.take()).toBeUndefined();
  });
});
