import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import type { PropsWithChildren } from "react";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import * as client from "@/app/_trpc/client";
import { useContentReviewQueue } from "@/hooks/useContentReviewQueue";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";
import { mockUserContextValue } from "../setup/userContext";

type Input = RouterInputs["contentReview"]["getQueue"];
type Counts = RouterOutputs["contentReview"]["getCounts"];
const clients: QueryClient[] = [];
const pending: Input = { status: "PENDING", category: null, source: null, limit: 25 };

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: testApi.useUtils,
    contentReview: testApi.contentReview,
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((queryClient) => queryClient.clear());
  vi.restoreAllMocks();
});
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

/** Exercise queue caching and the observed count query through real tRPC hooks. */
const setup = () => {
  let authoritative: Counts = {
    canReview: true,
    statuses: { PENDING: 3, OUTDATED: 1 },
    pendingByCategory: {},
  };
  let failCounts = false;
  let nextOutdatedCount = 1;
  let notifications = [
    {
      href: "/manual/review",
      name: "Content review (4)",
      color: "green",
      notificationCount: 4,
    },
  ];
  const updateNotifications = vi.fn(async (update) => {
    notifications = update(notifications);
  });
  mockUserContextValue({ data: { userId: "reviewer" }, updateNotifications } as never);
  const read = vi.fn((path: string, input: unknown) => {
    if (path === "contentReview.getCounts") {
      if (failCounts) throw new Error("Counts unavailable");
      return authoritative;
    }
    const request = input as Input;
    if (request.status !== "PENDING")
      return { items: [], outdatedCount: 0, nextCursor: null, canReview: true };
    return {
      items: [],
      outdatedCount: request.cursor ? nextOutdatedCount : 1,
      nextCursor: request.cursor ? null : "next",
      canReview: true,
    };
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(queryClient);
  // Keep the first count read deterministic: only queue outdating requests confirmation.
  queryClient.setQueryData(
    getQueryKey(testApi.contentReview.getCounts, undefined, "query"),
    { ...authoritative, statuses: { PENDING: 4, OUTDATED: 0 } },
  );
  const trpcClient = fakeTrpcClient(read);
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
      {children}
    </TrpcTestProviders>
  );
  const initialProps = { input: pending, enabled: true };
  const view = renderHook(
    ({ input, enabled }) => useContentReviewQueue(input, enabled),
    { wrapper, initialProps },
  );
  return {
    ...view,
    queryClient,
    initialProps,
    read,
    updateNotifications,
    notices: () => notifications,
    countReads: () =>
      read.mock.calls.filter(([path]) => path === "contentReview.getCounts").length,
    setCounts: (counts: Counts) => {
      authoritative = counts;
    },
    failCounts: (value: boolean) => {
      failCounts = value;
    },
    setNextOutdatedCount: (value: number) => {
      nextOutdatedCount = value;
    },
  };
};

it("confirms an outdated page once across cached tabs, filters and disabled stats", async () => {
  const test = setup();
  await settle();
  await settle();
  expect(test.countReads()).toBe(1);
  expect(test.result.current.counts?.statuses).toEqual({ PENDING: 3, OUTDATED: 1 });
  expect(test.notices()[0]?.notificationCount).toBe(3);
  test.rerender({ ...test.initialProps, input: { ...pending, status: "OUTDATED" } });
  await settle();
  test.rerender(test.initialProps);
  await settle();
  test.rerender({ ...test.initialProps, enabled: false });
  await settle();
  test.rerender(test.initialProps);
  await settle();
  expect(test.countReads()).toBe(1);
  test.rerender({ ...test.initialProps, input: { ...pending, category: "VISUAL" } });
  await settle();
  await settle();
  expect(test.countReads()).toBe(2);
  test.rerender(test.initialProps);
  await settle();
  expect(test.countReads()).toBe(2);
  expect(test.read.mock.calls.some(([path]) => path === "profile.getUser")).toBe(false);
});

it("confirms new outdating pages and fresh reads with identical payloads", async () => {
  const test = setup();
  await settle();
  await settle();
  test.setCounts({
    canReview: true,
    statuses: { PENDING: 2, OUTDATED: 2 },
    pendingByCategory: {},
  });
  await act(async () => {
    await test.result.current.queue.fetchNextPage();
  });
  await settle();
  await settle();
  expect(test.countReads()).toBe(2);
  expect(test.notices()[0]?.notificationCount).toBe(2);
  const cachedPages = test.result.current.queue.data?.pages;
  test.setCounts({ canReview: true, statuses: {}, pendingByCategory: {} });
  await act(async () => {
    await test.result.current.queue.refetch();
  });
  await settle();
  await settle();
  expect(test.countReads()).toBe(3);
  expect(test.result.current.queue.data?.pages).toBe(cachedPages);
  expect(test.notices()).toEqual([]);
});

it("does not consume an earlier page's notice again when a later page outdates nothing", async () => {
  const test = setup();
  await settle();
  await settle();
  test.setNextOutdatedCount(0);
  await act(async () => {
    await test.result.current.queue.fetchNextPage();
  });
  await settle();
  expect(test.countReads()).toBe(1);
});

it("keeps the last notice on count failure and reconciles a successful retry and lost permission", async () => {
  const test = setup();
  await settle();
  await settle();
  test.failCounts(true);
  await act(async () => {
    await test.result.current.queue.fetchNextPage();
  });
  await settle();
  await settle();
  expect(test.countReads()).toBe(2);
  expect(test.notices()[0]?.notificationCount).toBe(3);
  test.rerender({ ...test.initialProps, input: { ...pending, status: "OUTDATED" } });
  await settle();
  test.rerender(test.initialProps);
  await settle();
  expect(test.countReads()).toBe(2);
  test.failCounts(false);
  test.setCounts({ canReview: false, statuses: { PENDING: 2 }, pendingByCategory: {} });
  await act(async () => {
    await test.queryClient.refetchQueries({
      queryKey: getQueryKey(testApi.contentReview.getCounts),
    });
  });
  await settle();
  expect(test.countReads()).toBe(3);
  expect(test.notices()).toEqual([]);
  expect(test.result.current.counts?.canReview).toBe(false);
});
