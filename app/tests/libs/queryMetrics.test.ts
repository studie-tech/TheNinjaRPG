import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  InfiniteQueryObserver,
  onlineManager,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import {
  createTRPCClient,
  getUntypedClient,
  httpBatchLink,
  retryLink,
} from "@trpc/client";
import { waitFor } from "@testing-library/react";
import type * as Sentry from "@sentry/nextjs";
import superjson from "superjson";
import type { AppRouter } from "@/api/root";
import {
  createQueryMetricsTracker,
  queryMetricsHeaders,
  queryMetricsLink,
} from "@/libs/queryMetrics";
import {
  MAX_QUERY_METRICS_HEADER_LENGTH,
  parseQueryMetricsHeader,
  QUERY_METRICS_HEADER,
  type QueryAttribution,
  shouldSampleQueryMetric,
  stripQueryMetricUserAttributes,
} from "@/libs/queryTelemetry";

const close: (() => void)[] = [];
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const response = (url: RequestInfo | URL) =>
  Response.json(
    new URL(String(url)).pathname
      .split("/")
      .at(-1)!
      .split(",")
      .map(() => ({ result: { data: superjson.serialize({ value: 1 }) } })),
  );
const setup = (
  fetch?: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  random: () => number = () => 0,
) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.mount();
  const count = mock<typeof Sentry.metrics.count>(() => {});
  const tracker = createQueryMetricsTracker(client, { count }, random);
  const requests: {
    path: string;
    attribution: Record<string, QueryAttribution>;
    header: string;
  }[] = [];
  const trpc = createTRPCClient<AppRouter>({
    links: [
      queryMetricsLink(tracker),
      retryLink({ retry: ({ attempts }) => attempts < 2, retryDelayMs: () => 0 }),
      httpBatchLink({
        url: "http://localhost/api/trpc",
        transformer: superjson,
        headers: ({ opList }) => queryMetricsHeaders(opList),
        fetch: async (url, init) => {
          const header = new Headers(init?.headers).get(QUERY_METRICS_HEADER) ?? "{}";
          requests.push({
            path: new URL(String(url)).pathname,
            attribution: JSON.parse(header),
            header,
          });
          return fetch ? fetch(url, init) : response(url);
        },
      }),
    ],
  });
  const query = (path = "profile.getUser", input?: unknown, cached = true) => {
    const key = [
      path.split("."),
      { type: "query", ...(input === undefined ? {} : { input }) },
    ];
    if (cached) client.setQueryData(key, { value: 0 });
    const options = {
      queryKey: key,
      staleTime: Infinity,
      queryFn: () => getUntypedClient(trpc).query(path, input),
    };
    const observer = new QueryObserver(client, options);
    close.push(observer.subscribe(() => {}));
    return { key, options, observer };
  };
  const mutation = (
    path: string,
    handlers: {
      onSuccess?: () => Promise<unknown> | void;
      onError?: () => Promise<unknown> | void;
      mutationFn?: () => Promise<unknown>;
    },
  ) => {
    tracker.noteMutation(path);
    return client.getMutationCache().build(client, {
      mutationKey: [path.split(".")],
      networkMode: "always",
      mutationFn: async () => ({}),
      ...handlers,
    });
  };
  close.push(() => {
    client.unmount();
    client.clear();
  });
  return { client, tracker, trpc, query, mutation, requests, count };
};

afterEach(() => {
  for (const dispose of close.splice(0).reverse()) dispose();
  onlineManager.setOnline(true);
});

describe("generic query instrumentation", () => {
  it("samples invalidation calls independently while preserving attribution for unsampled calls", async () => {
    const draws = [0.02, 0.019999];
    const test = setup(undefined, () => draws.shift()!);
    const { key } = test.query();
    await test.client.invalidateQueries({ queryKey: key });
    expect(test.count).not.toHaveBeenCalled();
    expect(test.requests[0]?.attribution["profile.getUser"]).toEqual({
      trigger: "invalidation",
      mutationContext: "none",
    });
    await test.client.invalidateQueries({ queryKey: key });
    expect(test.requests).toHaveLength(2);
    expect(test.count).toHaveBeenCalledTimes(1);
    expect(test.count).toHaveBeenCalledWith("trpc.query.invalidation", 50, {
      attributes: {
        target: "profile.getUser",
        mutation_context: "none",
        sample_rate: 0.02,
      },
    });
  });

  it("keeps mutation context even when the invalidation metric is not sampled", async () => {
    const test = setup(undefined, () => 0.5);
    const { key } = test.query();
    await test
      .mutation("item.consume", {
        onSuccess: () => test.client.invalidateQueries({ queryKey: key }),
      })
      .execute(undefined);
    expect(test.requests[0]?.attribution["profile.getUser"]).toEqual({
      trigger: "invalidation",
      mutationContext: "item.consume",
    });
    expect(test.count).not.toHaveBeenCalled();
  });

  it("tracks initial reads for any procedure and sends no request for cache hits", async () => {
    const test = setup();
    const a = test.query("profile.getUser", undefined, false);
    await test.client.fetchQuery(a.options);
    const b = test.query("item.getUserItems", undefined, false);
    await test.client.fetchQuery(b.options);
    expect(test.requests.map((r) => Object.values(r.attribution)[0]?.trigger)).toEqual([
      "initial",
      "initial",
    ]);
    await test.client.fetchQuery(a.options);
    expect(test.requests).toHaveLength(2);
  });

  it("classifies observer refreshes of seeded queries as refreshes", async () => {
    const test = setup();
    const key = [["profile", "getUser"], { type: "query" }];
    const observer = new QueryObserver(test.client, {
      queryKey: key,
      initialData: { value: 0 },
      refetchOnMount: false,
      queryFn: () => getUntypedClient(test.trpc).query("profile.getUser"),
    });
    close.push(observer.subscribe(() => {}));
    expect(test.client.getQueryState(key)).toMatchObject({
      status: "success",
      dataUpdateCount: 0,
    });
    expect(test.requests).toHaveLength(0);
    await observer.refetch();
    expect(test.requests[0]?.attribution["profile.getUser"]).toEqual({
      trigger: "refresh",
      mutationContext: "none",
    });
  });

  it("classifies pagination of seeded infinite queries as refreshes", async () => {
    const test = setup();
    const key = [
      ["forum", "getThreads"],
      { type: "infinite", input: { boardName: "seeded" } },
    ];
    const observer = new InfiniteQueryObserver(test.client, {
      queryKey: key,
      initialPageParam: "cursor-one",
      getNextPageParam: () => "cursor-two",
      initialData: () => ({ pages: [{ value: 0 }], pageParams: ["cursor-one"] }),
      refetchOnMount: false,
      queryFn: ({ pageParam, direction }) =>
        getUntypedClient(test.trpc).query("forum.getThreads", {
          boardName: "seeded",
          cursor: pageParam,
          direction,
        }),
    });
    close.push(observer.subscribe(() => {}));
    expect(test.client.getQueryState(key)).toMatchObject({
      status: "success",
      dataUpdateCount: 0,
    });
    expect(test.requests).toHaveLength(0);
    await observer.fetchNextPage();
    expect(observer.getCurrentResult().data?.pages).toHaveLength(2);
    expect(test.requests[0]?.attribution["forum.getThreads"]).toEqual({
      trigger: "refresh",
      mutationContext: "none",
    });
  });

  it("observes ordinary tRPC invalidations without call-site annotations", async () => {
    const test = setup();
    const { key, options } = test.query("item.getUserItems");
    await test.client.fetchQuery({ ...options, staleTime: 0 });
    await test.client.invalidateQueries({ queryKey: key });
    expect(test.requests.at(-1)?.attribution["item.getUserItems"]?.trigger).toBe(
      "invalidation",
    );
    expect(test.count).toHaveBeenCalledWith("trpc.query.invalidation", 50, {
      attributes: {
        target: "item.getUserItems",
        mutation_context: "none",
        sample_rate: 0.02,
      },
    });
  });

  it("counts repeated invalidation calls even when both reuse an unfinished initial fetch", async () => {
    let release!: () => void;
    const test = setup(async (url) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return response(url);
    });
    const { key } = test.query("profile.getUser", undefined, false);
    await waitFor(() => expect(test.requests).toHaveLength(1));
    const a = test.client.invalidateQueries({ queryKey: key });
    const b = test.client.invalidateQueries({ queryKey: key });
    release();
    await Promise.all([a, b]);
    expect(test.count).toHaveBeenCalledTimes(2);
    expect(test.requests).toHaveLength(1);
    expect(test.requests[0]?.attribution["profile.getUser"]?.trigger).toBe("initial");
  });

  it("retains an inactive invalidation until a read starts, then clears it after a cache write", async () => {
    const test = setup();
    const { key, options } = test.query();
    await test.client.invalidateQueries({ queryKey: key, refetchType: "none" });
    expect(test.requests).toHaveLength(0);
    await test.client.fetchQuery(options);
    expect(test.requests[0]?.attribution["profile.getUser"]?.trigger).toBe(
      "invalidation",
    );
    await test.client.invalidateQueries({ queryKey: key, refetchType: "none" });
    test.client.setQueryData(key, { value: 2 });
    await test.client.refetchQueries({ queryKey: key });
    expect(test.requests[1]?.attribution["profile.getUser"]?.trigger).toBe("refetch");
  });

  it("records mutation context through asynchronous success callbacks and mutateAsync continuations", async () => {
    const test = setup();
    const { key } = test.query();
    const mutation = test.mutation("item.consume", {
      onSuccess: async () => {
        await Promise.resolve();
        await test.client.invalidateQueries({ queryKey: key });
      },
    });
    await mutation.execute(undefined);
    expect(test.requests[0]?.attribution["profile.getUser"]).toEqual({
      trigger: "invalidation",
      mutationContext: "item.consume",
    });
    await test.client.invalidateQueries({ queryKey: key });
    expect(test.requests[1]?.attribution["profile.getUser"]?.mutationContext).toBe(
      "item.consume",
    );
    await tick();
    await test.client.invalidateQueries({ queryKey: key });
    expect(test.requests[2]?.attribution["profile.getUser"]?.mutationContext).toBe(
      "none",
    );
  });

  it("records failure callback context without replacing the original mutation error", async () => {
    const test = setup();
    const { key } = test.query();
    const error = new Error("rejected");
    const mutation = test.mutation("item.consume", {
      mutationFn: async () => {
        throw error;
      },
      onError: async () => {
        await Promise.resolve();
        await test.client.invalidateQueries({ queryKey: key });
      },
    });
    await expect(mutation.execute(undefined)).rejects.toBe(error);
    expect(test.requests[0]?.attribution["profile.getUser"]?.mutationContext).toBe(
      "item.consume",
    );
  });

  it("marks overlapping mutation contexts instead of selecting one", async () => {
    const test = setup();
    const { key } = test.query();
    const releases: (() => void)[] = [];
    const handlers = {
      onSuccess: () => new Promise<void>((resolve) => releases.push(resolve)),
    };
    const a = test.mutation("item.consume", handlers).execute(undefined);
    const b = test.mutation("train.startTraining", handlers).execute(undefined);
    await waitFor(() => expect(releases).toHaveLength(2));
    await test.client.invalidateQueries({ queryKey: key });
    expect(test.requests[0]?.attribution["profile.getUser"]?.mutationContext).toBe(
      "multiple",
    );
    for (const release of releases) release();
    await Promise.all([a, b]);
  });

  it("keeps separate account clients and paused replacements independent", async () => {
    const first = setup();
    const second = setup();
    const a = first.query();
    const b = second.query();
    onlineManager.setOnline(false);
    await first
      .mutation("item.consume", {
        onSuccess: () => first.client.invalidateQueries({ queryKey: a.key }),
      })
      .execute(undefined);
    await tick();
    await first
      .mutation("train.startTraining", {
        onSuccess: () => first.client.invalidateQueries({ queryKey: a.key }),
      })
      .execute(undefined);
    await second.client.invalidateQueries({ queryKey: b.key });
    expect(first.requests).toHaveLength(0);
    onlineManager.setOnline(true);
    await waitFor(() => {
      expect(first.requests[0]?.attribution["profile.getUser"]?.mutationContext).toBe(
        "train.startTraining",
      );
      expect(second.requests[0]?.attribution["profile.getUser"]?.mutationContext).toBe(
        "none",
      );
    });
  });

  it("preserves the captured trigger on transport retries", async () => {
    let attempts = 0;
    const test = setup(async (url) => {
      if (++attempts === 1) throw new TypeError("Failed to fetch");
      return response(url);
    });
    const { key } = test.query();
    await test.client.invalidateQueries({ queryKey: key });
    expect(test.requests.map((r) => r.attribution["profile.getUser"]?.trigger)).toEqual(
      ["invalidation", "invalidation"],
    );
  });

  it("matches concurrent inputs without emitting input values", async () => {
    const releases: (() => void)[] = [];
    const test = setup(async (url) => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return response(url);
    });
    const a = test.query("profile.getPublicUser", { userId: "private-a" });
    const b = test.query("profile.getPublicUser", { userId: "private-b" });
    const first = test.client.invalidateQueries({ queryKey: a.key });
    const second = test.client.refetchQueries({ queryKey: b.key });
    expect(
      test.tracker.capture("profile.getPublicUser", { userId: "private-a" }).trigger,
    ).toBe("invalidation");
    expect(
      test.tracker.capture("profile.getPublicUser", { userId: "private-b" }).trigger,
    ).toBe("refetch");
    await waitFor(() => expect(test.requests).toHaveLength(1));
    expect(test.requests[0]?.attribution["profile.getPublicUser"]?.trigger).toBe(
      "mixed",
    );
    expect(
      JSON.stringify([test.requests[0]?.header, test.count.mock.calls]),
    ).not.toContain("private-");
    for (const release of releases) release();
    await Promise.all([first, second]);
  });

  it("matches infinite query keys independently of cursor and direction", async () => {
    const test = setup();
    const key = [
      ["comments", "getConversationComments"],
      { type: "infinite", input: { conversationId: "private" } },
    ];
    const observer = new InfiniteQueryObserver(test.client, {
      queryKey: key,
      initialPageParam: "cursor-one",
      getNextPageParam: () => undefined,
      queryFn: ({ pageParam, direction }) =>
        getUntypedClient(test.trpc).query("comments.getConversationComments", {
          conversationId: "private",
          cursor: pageParam,
          direction,
        }),
    });
    close.push(observer.subscribe(() => {}));
    await waitFor(() => expect(test.requests).toHaveLength(1));
    expect(
      test.requests[0]?.attribution["comments.getConversationComments"]?.trigger,
    ).toBe("initial");
    expect(test.requests[0]?.header).not.toContain("private");
    expect(test.requests[0]?.header).not.toContain("cursor-one");
  });

  it("records router and global targets without evaluating predicates an extra time", async () => {
    const test = setup();
    const { options } = test.query();
    await test.client.fetchQuery({ ...options, staleTime: 0 });
    const predicate = mock(() => true);
    await test.client.invalidateQueries({ queryKey: [["profile"]], predicate });
    expect(predicate).toHaveBeenCalledTimes(2);
    await test.client.invalidateQueries();
    expect(test.count.mock.calls.map((call) => call[2]?.attributes?.target)).toEqual([
      "profile",
      "all",
    ]);
  });

  it("never rejects an invalidation when client metrics fail", async () => {
    const test = setup();
    const { key } = test.query();
    test.count.mockImplementation(() => {
      throw new Error("telemetry unavailable");
    });
    await expect(
      test.client.invalidateQueries({ queryKey: key }),
    ).resolves.toBeUndefined();
    expect(test.requests[0]?.attribution["profile.getUser"]?.trigger).toBe(
      "invalidation",
    );
  });

  it("matches an infinite query with no input other than pagination metadata", async () => {
    const test = setup();
    const observer = new InfiniteQueryObserver(test.client, {
      queryKey: [["item", "getAll"], { type: "infinite" }],
      initialPageParam: "first",
      getNextPageParam: () => undefined,
      queryFn: ({ pageParam, direction }) =>
        getUntypedClient(test.trpc).query("item.getAll", {
          cursor: pageParam,
          direction,
        }),
    });
    close.push(observer.subscribe(() => {}));
    await waitFor(() =>
      expect(test.requests[0]?.attribution["item.getAll"]?.trigger).toBe("initial"),
    );
  });
});

describe("query telemetry header validation", () => {
  const procedures = new Map([
    ["profile.getUser", "query"],
    ["item.getUserItems", "query"],
    ["item.consume", "mutation"],
  ]);
  const value: QueryAttribution = {
    trigger: "invalidation",
    mutationContext: "item.consume",
  };
  const op = (path: string, attribution = value) => ({
    path,
    type: "query",
    context: { queryTelemetry: attribution },
  });
  it("uses the same event sampling boundary on client and server", () => {
    expect(shouldSampleQueryMetric(() => 0)).toBe(true);
    expect(shouldSampleQueryMetric(() => 0.019999)).toBe(true);
    expect(shouldSampleQueryMetric(() => 0.02)).toBe(false);
    expect(shouldSampleQueryMetric(() => 0.999999)).toBe(false);
  });
  it("validates all query paths and mutation context against the current router", () => {
    const header = queryMetricsHeaders([
      op("profile.getUser"),
      op("item.getUserItems"),
    ])[QUERY_METRICS_HEADER]!;
    expect([...parseQueryMetricsHeader(header, procedures)]).toEqual([
      ["profile.getUser", value],
      ["item.getUserItems", value],
    ]);
    const invalid = JSON.stringify({
      "profile.getUser": { trigger: "invalidation", mutationContext: "private-user" },
      "private-query": value,
    });
    expect([...parseQueryMetricsHeader(invalid, procedures)]).toEqual([
      ["profile.getUser", { trigger: "invalidation", mutationContext: "unknown" }],
    ]);
  });
  it("bounds oversized batches and ignores malformed diagnostics", () => {
    expect(
      queryMetricsHeaders(
        Array.from({ length: 100 }, (_, i) => op(`items.longProcedure${i}`)),
      ),
    ).toEqual({});
    for (const header of [
      null,
      "{}",
      "{",
      "[]",
      '"private"',
      "x".repeat(MAX_QUERY_METRICS_HEADER_LENGTH + 1),
    ]) {
      expect(parseQueryMetricsHeader(header, procedures).size).toBe(0);
    }
    expect(
      queryMetricsHeaders([{ path: "item.consume", type: "mutation", context: {} }]),
    ).toEqual({});
  });

  it("removes SDK-inherited user fields from aggregate metrics without changing other telemetry", () => {
    const original = {
      name: "trpc.query.invalidation",
      value: 1,
      attributes: {
        target: "profile.getUser",
        "user.id": "private-id",
        "user.email": "private@example.com",
        "user.name": "private-name",
        "sentry.release": "version",
      },
    };
    const clean = stripQueryMetricUserAttributes(original);
    expect(clean).toEqual({
      name: "trpc.query.invalidation",
      value: 1,
      attributes: { target: "profile.getUser", "sentry.release": "version" },
    });
    expect(original.attributes["user.id"]).toBe("private-id");
    const device = {
      name: "renderer.session",
      value: 1,
      attributes: { gpu: "Mali-G78", "user.id": "private-id" },
    };
    expect(stripQueryMetricUserAttributes(device).attributes).toEqual({
      gpu: "Mali-G78",
    });
    const unrelated = { ...original, name: "other.metric" };
    expect(stripQueryMetricUserAttributes(unrelated)).toBe(unrelated);
    const empty = { name: "trpc.mutation", value: 1 };
    expect(stripQueryMetricUserAttributes(empty)).toBe(empty);
  });
});
