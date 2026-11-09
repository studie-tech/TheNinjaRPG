import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useInfinitePagination } from "@/libs/pagination";

// Reports an observed element as intersecting while `visible` is true, the way a real
// observer reports the current state once for every element it starts observing.
let visible = true;
const OriginalObserver = globalThis.IntersectionObserver;
class FakeObserver {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    queueMicrotask(() =>
      this.callback(
        [{ target, isIntersecting: visible } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    );
  }
  unobserve() {}
  disconnect() {}
}

describe("useInfinitePagination", () => {
  beforeEach(() => {
    visible = true;
    globalThis.IntersectionObserver =
      FakeObserver as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    globalThis.IntersectionObserver = OriginalObserver;
  });

  // Simulates batches whose rows are all filtered out: the last element never changes.
  const setup = (totalPages: number) => {
    const lastElement = document.createElement("div");
    let pages = 1;
    const props = { hasNextPage: pages < totalPages };
    const fetchNextPage = async () => {
      await new Promise((r) => setTimeout(r, 0));
      pages += 1;
      props.hasNextPage = pages < totalPages;
      act(() => hook.rerender());
      return { isError: false };
    };
    const hook = renderHook(() =>
      useInfinitePagination({
        fetchNextPage,
        hasNextPage: props.hasNextPage,
        lastElement,
      }),
    );
    return { getPages: () => pages };
  };

  it("keeps loading while the unchanged last element stays visible", async () => {
    const { getPages } = setup(6);
    await waitFor(() => expect(getPages()).toBe(6));
  });

  it("stops when the last element is off screen", async () => {
    visible = false;
    const { getPages } = setup(6);
    await new Promise((r) => setTimeout(r, 20));
    expect(getPages()).toBe(1);
  });

  it("does not retry in a loop when a batch fails", async () => {
    let calls = 0;
    const lastElement = document.createElement("div");
    renderHook(() =>
      useInfinitePagination({
        fetchNextPage: async () => {
          calls += 1;
          return { isError: true };
        },
        hasNextPage: true,
        lastElement,
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
  });
});
