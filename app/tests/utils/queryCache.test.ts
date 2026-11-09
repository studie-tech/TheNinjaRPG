import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "bun:test";
import {
  mergeQueryChanges,
  prepareQueryUpdate,
  updateQueryCache,
} from "@/utils/queryCache";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((close) => close()));

const key = [["feature", "getRows"], { input: { category: "one" }, type: "query" }];
type Rows = { id: string; count: number }[];
const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData<Rows>(key, [{ id: "row", count: 10 }]);
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: key,
    staleTime: Infinity,
    queryFn: async (): Promise<Rows> => {
      reads++;
      return [{ id: "row", count: 7 }];
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  cleanups.push(() => {
    unsubscribe();
    client.clear();
  });
  return {
    client,
    observer,
    reads: () => reads,
    value: () => client.getQueryData<Rows>(key),
  };
};

describe("query cache reconciliation", () => {
  it.each([
    "missing revision",
    "stale revision",
    "unknown update",
    "rejected projection",
  ] as const)(
    "preserves %s without starting a read when refetch is disabled",
    async (reason) => {
      const test = setup();
      const revision = prepareQueryUpdate(test.client, key);
      if (reason === "stale revision")
        test.client.setQueryData<Rows>(key, [{ id: "row", count: 12 }]);
      const before = test.client.getQueryState(key);
      expect(
        await updateQueryCache<Rows>(
          test.client,
          key,
          reason === "unknown update"
            ? undefined
            : reason === "rejected projection"
              ? () => undefined
              : (rows) => rows.map((row) => ({ ...row, count: row.count - 1 })),
          {
            revision: reason === "missing revision" ? undefined : revision,
            refetch: false,
          },
        ),
      ).toBe(false);
      expect(test.client.getQueryState(key)).toBe(before);
      expect(test.reads()).toBe(0);
    },
  );

  it("leaves an existing read running instead of cancelling or replacing it", async () => {
    const test = setup();
    const revision = prepareQueryUpdate(test.client, key);
    let finish!: (rows: Rows) => void;
    let signal!: AbortSignal;
    const pending = test.client.fetchQuery({
      queryKey: key,
      staleTime: 0,
      queryFn: (context) => {
        signal = context.signal;
        return new Promise<Rows>((resolve) => {
          finish = resolve;
        });
      },
    });
    const before = test.client.getQueryState(key);
    expect(
      await updateQueryCache<Rows>(test.client, key, () => [{ id: "row", count: 9 }], {
        revision,
        refetch: false,
      }),
    ).toBe(false);
    expect(test.client.getQueryState(key)).toBe(before);
    expect(signal.aborted).toBe(false);
    finish([{ id: "row", count: 8 }]);
    await pending;
    expect(test.value()).toEqual([{ id: "row", count: 8 }]);
    expect(test.reads()).toBe(0);
  });

  it("applies a known local patch without opting into revision-bound reconciliation", async () => {
    const test = setup();
    expect(
      await updateQueryCache<Rows>(test.client, key, () => [{ id: "row", count: 9 }], {
        refetch: false,
      }),
    ).toBe(true);
    expect(test.value()).toEqual([{ id: "row", count: 9 }]);
    expect(test.reads()).toBe(0);
    expect(test.client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("updates array responses without fetching and leaves other inputs untouched", async () => {
    const test = setup();
    const otherKey = [
      ["feature", "getRows"],
      { input: { category: "two" }, type: "query" },
    ];
    const other = [{ id: "other", count: 20 }];
    test.client.setQueryData(otherKey, other);
    const revision = prepareQueryUpdate(test.client, key);
    await updateQueryCache<Rows>(
      test.client,
      key,
      (rows) => rows.map((row) => ({ ...row, count: row.count - 3 })),
      { revision },
    );
    expect(test.value()).toEqual([{ id: "row", count: 7 }]);
    expect(test.client.getQueryData(otherKey)).toBe(other);
    expect(test.reads()).toBe(0);
  });

  it("supports scalar and null query results without constructing missing caches", async () => {
    const test = setup();
    const scalarKey = ["scalar"];
    test.client.setQueryData(scalarKey, 0);
    const revision = prepareQueryUpdate(test.client, scalarKey);
    expect(revision).toBeDefined();
    await updateQueryCache<number | null>(test.client, scalarKey, () => null, {
      revision,
    });
    expect(test.client.getQueryData(scalarKey)).toBeNull();
    expect(prepareQueryUpdate(test.client, scalarKey)).toBeDefined();
    await updateQueryCache(test.client, ["missing"], () => ({ count: 1 }));
    expect(test.client.getQueryData(["missing"])).toBeUndefined();
  });

  it("refreshes overlapping changes instead of applying a delta twice", async () => {
    const test = setup();
    const revision = prepareQueryUpdate(test.client, key);
    await updateQueryCache<Rows>(
      test.client,
      key,
      (rows) => rows.map((row) => ({ ...row, count: row.count - 1 })),
      { revision },
    );
    await updateQueryCache<Rows>(
      test.client,
      key,
      (rows) => rows.map((row) => ({ ...row, count: row.count - 2 })),
      { revision },
    );
    expect(test.value()).toEqual([{ id: "row", count: 7 }]);
    expect(test.reads()).toBe(1);
  });

  it("refreshes when a feature cannot build a complete patch", async () => {
    const test = setup();
    await updateQueryCache<Rows>(test.client, key, () => undefined, {
      revision: prepareQueryUpdate(test.client, key),
    });
    expect(test.value()).toEqual([{ id: "row", count: 7 }]);
    expect(test.reads()).toBe(1);
  });

  it("leaves initial loading running at capture and replaces its pre-mutation result", async () => {
    const test = setup();
    test.client.removeQueries({ queryKey: key, exact: true });
    let finish!: (rows: Rows) => void;
    const pending = test.client
      .fetchQuery({
        queryKey: key,
        queryFn: () =>
          new Promise<Rows>((resolve) => {
            finish = resolve;
          }),
      })
      .catch(() => undefined);
    expect(prepareQueryUpdate(test.client, key)).toBeUndefined();
    expect(test.client.getQueryState(key)?.fetchStatus).toBe("fetching");
    // Restore the mounted observer's read after the controlled initial request.
    test.observer.setOptions({
      queryKey: key,
      staleTime: Infinity,
      queryFn: async () => [{ id: "row", count: 7 }],
    });
    await updateQueryCache<Rows>(test.client, key, () => [{ id: "row", count: 7 }], {
      revision: undefined,
    });
    finish([{ id: "row", count: 10 }]);
    await pending;
    expect(test.value()).toEqual([{ id: "row", count: 7 }]);
  });

  it("keeps pending reconciliation after a local array patch", async () => {
    const test = setup();
    await test.client.invalidateQueries({
      queryKey: key,
      exact: true,
      refetchType: "none",
    });
    await updateQueryCache<Rows>(test.client, key, (rows) =>
      rows.map((row) => ({ ...row, count: 9 })),
    );
    expect(test.value()).toEqual([{ id: "row", count: 7 }]);
    expect(test.reads()).toBe(1);
  });
});

it("reports local application separately from authoritative recovery for dependent caches", async () => {
  const test = setup();
  const snapshot = { revision: prepareQueryUpdate(test.client, key) };
  expect(await updateQueryCache<Rows>(test.client, key, (rows) => rows, snapshot)).toBe(
    true,
  );
  expect(await updateQueryCache<Rows>(test.client, key, (rows) => rows, snapshot)).toBe(
    false,
  );
  expect(test.reads()).toBe(1);
  expect(
    await updateQueryCache<Rows>(test.client, key, undefined, {
      revision: prepareQueryUpdate(test.client, key),
    }),
  ).toBe(false);
  expect(test.reads()).toBe(2);
});

describe("query patch and delta merging", () => {
  it("merges nested values, keeps sibling fields and adds to the original balances", () => {
    const current = {
      id: "one",
      count: 10,
      relation: { id: "two", count: 20, name: "kept" },
    };
    const next = mergeQueryChanges(
      current,
      { count: 100, relation: { id: "two" } },
      {
        count: -3,
        relation: { id: "two", count: 5 },
      },
    );
    expect(next).toEqual({
      id: "one",
      count: 7,
      relation: { id: "two", count: 25, name: "kept" },
    });
    expect(current.count).toBe(10);
    expect(current.relation.count).toBe(20);
  });

  it("replaces arrays, dates and null values while applying feature caps", () => {
    const at = new Date(2000);
    const current = {
      rows: [1, 2],
      at: new Date(1000),
      name: "old" as string | null,
      count: 9,
    };
    expect(
      mergeQueryChanges(
        current,
        { rows: [], at, name: null },
        { count: 10 },
        { count: 10 },
      ),
    ).toEqual({ rows: [], at, name: null, count: 10 });
  });

  it("rejects a different relation without applying the accompanying debit", () => {
    const current = { count: 10, relation: { id: "one", count: 20 } };
    expect(
      mergeQueryChanges(current, { relation: { id: "other" } }, { count: -3 }),
    ).toBeUndefined();
    expect(
      mergeQueryChanges(current, {}, { relation: { id: "other", count: -3 } }),
    ).toBeUndefined();
    expect(current.count).toBe(10);
  });

  it("rejects numeric deltas when their baseline is unknown", () => {
    const current: { count?: number } = {};
    expect(mergeQueryChanges(current, {}, { count: 1 })).toBeUndefined();
  });
});
