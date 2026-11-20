import { afterEach, expect, it, setSystemTime, vi } from "bun:test";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import * as client from "@/app/_trpc/client";
import * as refreshAt from "@/hooks/useRefreshAt";
import { useSplash } from "@/hooks/useSplash";
import { deferred } from "../setup/deferred";
import { splashEntry } from "../setup/splash";

type Edition = client.RouterOutputs["splash"]["get"];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  setSystemTime();
});

it.each([false, true])(
  "reads the post-boundary edition while a pre-boundary request is pending (cached: %s)",
  async (hasCache) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const key = ["splash-refresh-test"];
    const oldEdition: Edition = {
      announcements: [splashEntry()],
      fetchedAt: new Date(0),
      nextChangeAt: null,
    };
    const newEdition: Edition = {
      ...oldEdition,
      announcements: [splashEntry({ name: "New edition" })],
      fetchedAt: new Date(),
    };
    if (hasCache) queryClient.setQueryData(key, oldEdition);
    const oldRequest = deferred<Edition>();
    const newRequest = deferred<Edition>();
    const requests = vi
      .fn()
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => newRequest.promise);
    let onBoundary = () => {};
    vi.spyOn(refreshAt, "useRefreshAt").mockImplementation((_dates, callback) => {
      onBoundary = callback;
    });
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({
        splash: { get: { cancel: () => queryClient.cancelQueries({ queryKey: key }) } },
      }),
      splash: {
        get: {
          useQuery: () =>
            useQuery({ queryKey: key, queryFn: requests, staleTime: Infinity }),
        },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useSplash(true), { wrapper });
    if (hasCache)
      act(() => {
        void hook.result.current.refetch();
      });
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(1));
    act(() => onBoundary());
    await waitFor(() => expect(requests).toHaveBeenCalledTimes(2));
    await act(async () => {
      newRequest.resolve(newEdition);
    });
    await waitFor(() =>
      expect(hook.result.current.data?.announcements[0]?.name).toBe("New edition"),
    );
    await act(async () => {
      oldRequest.resolve(oldEdition);
    });
    expect(hook.result.current.data?.announcements[0]?.name).toBe("New edition");
    queryClient.clear();
  },
);

it.each([false, true])(
  "preserves midnight across grace-window renders and schedules the next day (cached: %s)",
  async (hasCache) => {
    vi.useFakeTimers();
    setSystemTime(new Date("2026-11-19T23:59:59.500Z"));
    const cancel = vi.fn(async () => {});
    const refetch = vi.fn(async () => ({}));
    const edition: Edition = {
      announcements: [splashEntry()],
      fetchedAt: new Date(),
      nextChangeAt: null,
    };
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({ splash: { get: { cancel } } }),
      splash: {
        get: { useQuery: () => ({ data: hasCache ? edition : undefined, refetch }) },
      },
    });
    const { rerender } = renderHook(() => useSplash(true));
    act(() => {
      vi.advanceTimersByTime(750);
    });
    rerender();
    expect(refetch).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(750);
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith({ cancelRefetch: true });
    // An unchanged snapshot or failed read must still leave tomorrow's UTC refresh scheduled.
    await act(async () => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(refetch).toHaveBeenCalledTimes(2);
  },
);

it.each([false, true])(
  "keeps midnight pending for a publication read crossing UTC days (finishes after midnight refresh: %s)",
  async (finishesLast) => {
    vi.useFakeTimers();
    setSystemTime(new Date("2026-11-19T23:59:57.500Z"));
    const cancel = vi.fn(async () => {});
    const publicationRead = deferred<object>();
    const refetch = vi
      .fn()
      .mockImplementationOnce(() => publicationRead.promise)
      .mockResolvedValue({});
    const edition: Edition = {
      announcements: [splashEntry()],
      fetchedAt: new Date(),
      nextChangeAt: new Date("2026-11-19T23:59:58.000Z"),
    };
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({ splash: { get: { cancel } } }),
      splash: { get: { useQuery: () => ({ data: edition, refetch }) } },
    });
    renderHook(() => useSplash(true));
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(finishesLast ? 2250 : 1250);
      publicationRead.resolve({});
    });
    if (!finishesLast)
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(refetch).toHaveBeenCalledTimes(2);
    // A delayed publication result cannot replace the newer UTC refresh's deadline.
    await act(async () => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });
    expect(refetch).toHaveBeenCalledTimes(3);
  },
);
