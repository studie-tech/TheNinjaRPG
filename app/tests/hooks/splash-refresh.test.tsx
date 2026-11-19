import { afterEach, expect, it, vi } from "bun:test";
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
