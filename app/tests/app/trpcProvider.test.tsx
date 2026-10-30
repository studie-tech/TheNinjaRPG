import * as clerk from "@clerk/nextjs";
import * as Sentry from "@sentry/nextjs";
import type { Clerk } from "@clerk/shared/types";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { type QueryClient, QueryObserver, useQueryClient } from "@tanstack/react-query";
import { type TRPCClient, TRPCClientError } from "@trpc/client";
import * as trpcClient from "@trpc/client";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { toast as sonnerToast } from "sonner";
import superjson from "superjson";
import type { AppRouter } from "@/api/root";
import * as clientModule from "@/app/_trpc/client";
import TrpcClientProvider from "@/app/_trpc/Provider";
import * as toast from "@/libs/toast";
import { SESSION_CHANGED_MESSAGE, SESSION_EXPIRED_MESSAGE } from "@/libs/trpcSession";
import { QUERY_METRICS_HEADER } from "@/libs/queryTelemetry";
import { shareUserCache } from "@/utils/userCacheSharing";
import { actualShowMutationToast } from "../setup/preload";

const testApi = createTRPCReact<AppRouter>();
let queryClient: QueryClient;
const toastMessages = () =>
  sonnerToast
    .getToasts()
    .map((notice) => ("description" in notice ? notice.description : undefined));

const session = (id: string, getToken = async (): Promise<string | null> => id) =>
  ({ id, getToken }) as NonNullable<Clerk["session"]>;

/** Mount the real provider with independent hooks despite persistent module mocks. */
const mountProvider = (
  activeSession: NonNullable<Clerk["session"]>,
  children?: React.ReactNode,
) => {
  const auth = {
    session: activeSession,
    isSignedIn: true,
    addListener: () => () => {},
  };
  vi.spyOn(clerk, "useClerk").mockReturnValue(
    auth as unknown as ReturnType<typeof clerk.useClerk>,
  );
  // Other suites replace this shared module; use fresh tRPC context and client factories.
  Object.assign(vi.spyOn(clientModule, "api" as never), {
    Provider: testApi.Provider,
    createClient: testApi.createClient,
    profile: testApi.profile,
  });
  let trpc!: TRPCClient<AppRouter>;
  const Probe = () => {
    queryClient = useQueryClient();
    trpc = testApi.useUtils().client;
    return null;
  };
  const view = render(
    <TrpcClientProvider cdnCachedQueryPaths={[]}>
      <Probe />
      {children}
    </TrpcClientProvider>,
  );
  return { auth, trpc, unmount: view.unmount };
};

/** Exercise local mutation feedback through the provider's real dispatch lifecycle. */
const mountArenaMutation = (activeSession: NonNullable<Clerk["session"]>) => {
  let attack!: () => Promise<unknown>;
  const onSuccess = vi.fn();
  const onError = vi.fn((error: { message: string }) => {
    toast.showMutationToast({ success: false, message: error.message });
  });
  const ArenaChallenge = () => {
    const mutation = testApi.combat.startArenaBattle.useMutation({
      onSuccess,
      onError,
    });
    attack = () => mutation.mutateAsync({ aiId: "opponent", autoCombat: false });
    return null;
  };
  return {
    ...mountProvider(activeSession, <ArenaChallenge />),
    attack: () => attack(),
    onSuccess,
    onError,
  };
};

beforeEach(() => {
  sonnerToast.dismiss();
  // Restore the real helper even when another suite has installed a toast module mock.
  vi.spyOn(toast, "showMutationToast").mockImplementation(actualShowMutationToast);
});

afterEach(() => {
  cleanup();
  queryClient?.clear();
  sonnerToast.dismiss();
  vi.restoreAllMocks();
});

it("preserves profile sharing for imperative reads without changing other query defaults", async () => {
  mountProvider(session("a"));
  const key = getQueryKey(testApi.profile.getUser, undefined, "query");
  expect(queryClient.getQueryDefaults(key).structuralSharing).toBe(shareUserCache);
  expect(
    queryClient.getQueryDefaults(
      getQueryKey(testApi.profile.getDashboard, undefined, "query"),
    ).structuralSharing,
  ).toBeUndefined();
  const initial = {
    userData: { updatedAt: new Date(1000) },
    achievementProgress: [{ startedAt: new Date(1000) }],
  };
  queryClient.setQueryData(key, initial);
  await queryClient.fetchQuery({
    queryKey: key,
    staleTime: 0,
    queryFn: async () => structuredClone(initial),
  });
  expect(queryClient.getQueryData(key)).toBe(initial);
});

it("leaves a same-session mutation successful", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json([{ result: { data: superjson.serialize({ success: true }) } }]),
  );
  const { attack, onSuccess, onError } = mountArenaMutation(session("a"));
  await act(async () => {
    await expect(attack()).resolves.toEqual({ success: true });
  });
  expect(queryClient.isMutating()).toBe(0);
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(onError).not.toHaveBeenCalled();
  expect(toastMessages()).toEqual([]);
});

it("sends captured profile causes through the provider without replacing session headers", async () => {
  const requests: Headers[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    requests.push(new Headers(init?.headers));
    return Response.json([
      { result: { data: superjson.serialize({ userData: { money: 100 } }) } },
    ]);
  });
  let refresh!: () => Promise<void>;
  const Player = () => {
    testApi.profile.getUser.useQuery(undefined, { retry: false });
    const utils = testApi.useUtils();
    refresh = () => utils.profile.getUser.invalidate();
    return null;
  };
  mountProvider(session("a"), <Player />);
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
  await act(async () => {
    await refresh();
  });
  expect(
    requests.map(
      (headers) =>
        JSON.parse(headers.get(QUERY_METRICS_HEADER)!)["profile.getUser"].trigger,
    ),
  ).toEqual(["initial", "invalidation"]);
  expect(requests.every((headers) => headers.get("Authorization") === "Bearer a")).toBe(
    true,
  );
});

it("coalesces a retired account's late batch while every query and mutation settles as failed", async () => {
  const releases: Array<() => void> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const count = new URL(String(input), "http://localhost").pathname
      .split("/")
      .at(-1)!
      .split(",").length;
    await new Promise<void>((resolve) => releases.push(resolve));
    return Response.json(
      Array.from({ length: count }, () => ({
        result: {
          data: superjson.serialize({ success: true, newStatus: "ASLEEP" }),
        },
      })),
    );
  });
  const { auth, trpc } = mountProvider(session("a"));
  const queries = [
    () => trpc.war.getWarPointClaims.query(),
    () => trpc.war.getWarCampNotices.query(),
    () => trpc.profile.getDashboard.query(),
    () => trpc.bank.getPendingInterest.query(),
    () => trpc.gameAsset.getSceneAssets.query({ assetIds: [] }),
  ];
  const pendingQueries = queries.map((queryFn, i) =>
    queryClient.fetchQuery({
      queryKey: ["late", i],
      queryFn: queryFn as () => Promise<unknown>,
      retry: false,
    }),
  );
  const onSuccess = vi.fn();
  const mutation = queryClient.getMutationCache().build(queryClient, {
    mutationKey: [["home", "toggleSleep"]],
    mutationFn: () => trpc.home.toggleSleep.mutate(),
    onSuccess,
  });
  const settled = Promise.allSettled([...pendingQueries, mutation.execute(undefined)]);
  await waitFor(() => expect(releases).toHaveLength(2));
  expect(queryClient.isFetching()).toBe(5);
  expect(mutation.state.status).toBe("pending");
  auth.session = session("b");
  for (const release of releases) release();
  const results = await settled;
  expect(results).toHaveLength(6);
  for (const result of results) {
    expect(result.status).toBe("rejected");
    if (result.status === "rejected")
      expect(result.reason.message).toBe(SESSION_CHANGED_MESSAGE);
  }
  expect(queryClient.isFetching()).toBe(0);
  for (const query of queryClient.getQueryCache().getAll()) {
    expect(query.state).toMatchObject({
      status: "error",
      fetchStatus: "idle",
      data: undefined,
    });
  }
  expect(mutation.state.status).toBe("error");
  expect(onSuccess).not.toHaveBeenCalled();
  expect(toastMessages()).toEqual([SESSION_CHANGED_MESSAGE]);
});

it("coalesces expired-session failures before dispatch", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const { trpc } = mountProvider(session("a", async () => null));
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) =>
      queryClient.fetchQuery({
        queryKey: ["expired", i],
        queryFn: () => trpc.profile.getUser.query(),
        retry: false,
      }),
    ),
  );
  expect(results.every((result) => result.status === "rejected")).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
  expect(queryClient.isFetching()).toBe(0);
  expect(toastMessages()).toEqual([SESSION_EXPIRED_MESSAGE]);
});

it("coalesces a local mutation error after unmount with a retired account's late query batch", async () => {
  const releases: Array<() => void> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const count = new URL(String(input), "http://localhost").pathname
      .split("/")
      .at(-1)!
      .split(",").length;
    await new Promise<void>((resolve) => releases.push(resolve));
    return Response.json(
      Array.from({ length: count }, () => ({
        result: { data: superjson.serialize({ success: true, battleId: "battle-a" }) },
      })),
    );
  });
  const { auth, trpc, unmount, attack, onSuccess, onError } = mountArenaMutation(
    session("a"),
  );
  let settled!: Promise<PromiseSettledResult<unknown>[]>;
  act(() => {
    settled = Promise.allSettled([
      queryClient.fetchQuery({
        queryKey: ["late-local", "dashboard"],
        queryFn: () => trpc.profile.getDashboard.query(),
        retry: false,
      }),
      queryClient.fetchQuery({
        queryKey: ["late-local", "notices"],
        queryFn: () => trpc.war.getWarCampNotices.query(),
        retry: false,
      }),
      attack(),
    ]);
  });
  await waitFor(() => expect(releases).toHaveLength(2));
  auth.session = session("b");
  unmount();
  for (const release of releases) release();
  const results = await settled;
  expect(results.map((result) => result.status)).toEqual([
    "rejected",
    "rejected",
    "rejected",
  ]);
  for (const result of results) {
    if (result.status === "rejected")
      expect(result.reason.message).toBe(SESSION_CHANGED_MESSAGE);
  }
  expect(queryClient.isFetching()).toBe(0);
  expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe("error");
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(toastMessages()).toEqual([SESSION_CHANGED_MESSAGE]);
});

it("coalesces expired-session notices from a query and a local mutation handler", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const { trpc, attack, onSuccess, onError } = mountArenaMutation(
    session("a", async () => null),
  );
  let results!: PromiseSettledResult<unknown>[];
  await act(async () => {
    results = await Promise.allSettled([
      queryClient.fetchQuery({
        queryKey: ["expired-local"],
        queryFn: () => trpc.profile.getUser.query(),
        retry: false,
      }),
      attack(),
    ]);
  });
  expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(fetch).not.toHaveBeenCalled();
  expect(queryClient.isFetching()).toBe(0);
  expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe("error");
  expect(onSuccess).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(toastMessages()).toEqual([SESSION_EXPIRED_MESSAGE]);
});

it.each([SESSION_CHANGED_MESSAGE, SESSION_EXPIRED_MESSAGE])(
  "preserves explicit toast IDs for %s",
  (message) => {
    for (const id of ["first-session-notice", "second-session-notice"]) {
      toast.showMutationToast({ success: false, message, id });
    }
    expect(sonnerToast.getToasts().map((notice) => notice.id)).toEqual([
      "first-session-notice",
      "second-session-notice",
    ]);
  },
);

it("keeps success messages and ReactNode error messages as separate notices", () => {
  const message = <span>{SESSION_CHANGED_MESSAGE}</span>;
  for (let i = 0; i < 2; i++) {
    toast.showMutationToast({ success: true, message: SESSION_CHANGED_MESSAGE });
    toast.showMutationToast({ success: false, message });
  }
  expect(toastMessages()).toEqual([
    SESSION_CHANGED_MESSAGE,
    message,
    SESSION_CHANGED_MESSAGE,
    message,
  ]);
});

it("keeps ordinary action failures as separate notices", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json([
      {
        error: superjson.serialize({
          message: "Please wait before trying again.",
          code: -32029,
          data: { code: "TOO_MANY_REQUESTS" },
        }),
      },
    ]),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { trpc } = mountProvider(session("a"));
  for (let i = 0; i < 2; i++) {
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: [["home", "toggleSleep"]],
      mutationFn: () => trpc.home.toggleSleep.mutate(),
    });
    await expect(mutation.execute(undefined)).rejects.toThrow(
      "Please wait before trying again.",
    );
    expect(mutation.state.status).toBe("error");
  }
  expect(toastMessages()).toEqual([
    "Please wait before trying again.",
    "Please wait before trying again.",
  ]);
});

it("does not retry a rate-limited query back into the same limiter window", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json([
      {
        error: superjson.serialize({
          message: "Too many requests for this page. Please wait a moment and try again.",
          code: -32029,
          data: { code: "TOO_MANY_REQUESTS" },
        }),
      },
    ]),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { trpc } = mountProvider(session("a"));
  // Observers carry the provider's retry default; imperative reads never retry.
  const observer = new QueryObserver(queryClient, {
    queryKey: getQueryKey(testApi.misc.getSetting, { name: "x" }, "query"),
    queryFn: () => trpc.misc.getSetting.query({ name: "x" }),
    retryDelay: 0,
  });
  await new Promise<void>((resolve) => {
    const unsubscribe = observer.subscribe((result) => {
      if (result.status !== "error") return;
      unsubscribe();
      resolve();
    });
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps imperative reads free of React Query retries", async () => {
  // The transport link never retries BAD_REQUEST, so each call here is one React Query attempt.
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json([
      {
        error: superjson.serialize({
          message: "Bad input",
          code: -32600,
          data: { code: "BAD_REQUEST" },
        }),
      },
    ]),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { trpc } = mountProvider(session("a"));
  const read = (name: string, retry?: number) =>
    queryClient.fetchQuery({
      queryKey: getQueryKey(testApi.misc.getSetting, { name }, "query"),
      queryFn: () => trpc.misc.getSetting.query({ name }),
      retryDelay: 0,
      ...(retry === undefined ? {} : { retry }),
    });
  await expect(read("y")).rejects.toThrow("Bad input");
  expect(fetch).toHaveBeenCalledTimes(1);
  // An explicit caller retry still applies.
  await expect(read("z", 1)).rejects.toThrow("Bad input");
  expect(fetch).toHaveBeenCalledTimes(3);
});

const fetchFailure = (message = "Failed to fetch") => {
  const error = new TypeError(message);
  error.stack = `${message}\n    at fetch (fetch:1:1)`;
  return error;
};

it.each([
  "Failed to fetch",
  '\"Offline\" is not valid JSON',
  '\"<!DOCTYPE \"... is not valid JSON',
])(
  "settles a mutation with uncertain-outcome feedback and no retry for %s",
  async (message) => {
    let rejectFetch!: (error: Error) => void;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((_resolve, reject) => {
          rejectFetch = reject;
        }),
    );
    const capture = vi.spyOn(Sentry, "captureException");
    const onSuccess = vi.fn();
    let change!: () => Promise<unknown>;
    const EventAction = () => {
      const mutation = testApi.misc.setEventGameSetting.useMutation({ onSuccess });
      change = () =>
        mutation.mutateAsync({
          setting: "regenGainMultiplier",
          multiplier: "2",
          days: 1,
        });
      return (
        <button type="button" disabled={mutation.isPending}>
          {mutation.isPending ? "Changing setting" : "Change setting"}
        </button>
      );
    };
    mountProvider(session("a"), <EventAction />);
    let settled!: Promise<PromiseSettledResult<unknown>[]>;
    act(() => {
      settled = Promise.allSettled([change()]);
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button").textContent).toBe("Changing setting"),
    );
    expect(toastMessages()).toEqual([]);
    await act(async () => {
      rejectFetch(fetchFailure(message));
      await settled;
    });
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button").disabled).toBe(false),
    );
    expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe("error");
    expect(screen.getByRole("button").textContent).toBe("Change setting");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(toastMessages()).toEqual([
      "Could not confirm whether this action completed. Refresh the page to check the result before trying again.",
    ]);
    expect(capture).not.toHaveBeenCalled();
  },
);

it("leaves transport feedback to a caller's onError without a duplicate notice", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(fetchFailure());
  const { attack, onError } = mountArenaMutation(session("a"));
  await act(async () => {
    await expect(attack()).rejects.toThrow("Failed to fetch");
  });
  expect(onError).toHaveBeenCalledTimes(1);
  expect(toastMessages()).toEqual(["Failed to fetch"]);
});

it.each([true, false])(
  "preserves catch-based recovery without hiding server errors: transport=%s",
  async (transport) => {
    const capture = vi.spyOn(Sentry, "captureException").mockReturnValue("event");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mountProvider(session("a"));
    const error = transport
      ? TRPCClientError.from(fetchFailure())
      : TRPCClientError.from({
          error: {
            message: "Server failed",
            code: -32603,
            data: { code: "INTERNAL_SERVER_ERROR" },
          },
        });
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: [["item", "consume"]],
      meta: { handlesTransportError: true },
      mutationFn: async () => {
        throw error;
      },
    });
    try {
      await mutation.execute(undefined);
    } catch {
      if (transport)
        toast.showMutationToast({
          success: false,
          message: "Refresh your inventory to check the result.",
        });
    }
    expect(mutation.state.status).toBe("error");
    expect(toastMessages()).toEqual([
      transport ? "Refresh your inventory to check the result." : "Server failed",
    ]);
    expect(capture).toHaveBeenCalledTimes(transport ? 0 : 1);
  },
);

it.each([true, false])(
  "reports only exhausted query retries: recover=%s",
  async (recover) => {
    // Exercise the real retry link and policy without waiting through its backoff.
    const retryLink = trpcClient.retryLink;
    const delays: number[] = [];
    vi.spyOn(trpcClient, "retryLink").mockImplementation((options) =>
      retryLink({
        ...options,
        retryDelayMs: (attempt) => {
          delays.push(options.retryDelayMs?.(attempt) ?? 0);
          return 0;
        },
      }),
    );
    const capture = vi.spyOn(Sentry, "captureException");
    let attempts = 0;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      attempts++;
      // No cache error callback (and no toast) while retryLink is still trying.
      expect(toastMessages()).toEqual([]);
      if (recover && attempts === 2) {
        return Response.json([
          { result: { data: superjson.serialize({ success: true }) } },
        ]);
      }
      throw fetchFailure();
    });
    const { trpc } = mountProvider(session("a"));
    const settled = await Promise.allSettled([
      queryClient.fetchQuery({
        queryKey: ["transport-query"],
        queryFn: () => trpc.profile.getUser.query(),
        // Let the real retryLink exhaust its policy without adding TanStack's own retries.
        retry: false,
      }),
    ]);
    expect(fetch).toHaveBeenCalledTimes(recover ? 2 : 4);
    expect(delays).toEqual(recover ? [2_000] : [2_000, 4_000, 8_000]);
    expect(settled[0]?.status).toBe(recover ? "fulfilled" : "rejected");
    expect(queryClient.isFetching()).toBe(0);
    expect(toastMessages()).toEqual(
      recover
        ? []
        : [
            "Could not load the latest data. Check your connection and refresh the page.",
          ],
    );
    expect(capture).not.toHaveBeenCalled();
  },
);
