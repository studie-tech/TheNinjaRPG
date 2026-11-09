import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { getQueryKey } from "@trpc/react-query";
import { observable } from "@trpc/server/observable";
import { getDefaultStore } from "jotai";
import * as navigation from "next/navigation";
import * as Pusher from "pusher-js";
import * as client from "@/app/_trpc/client";
import * as mastery from "@/hooks/useMasteryQueueRefresh";
import * as refresh from "@/hooks/useRefreshAt";
import { chatMentionsAtom } from "@/libs/chatPanel";
import * as toast from "@/libs/toast";
import * as routing from "@/utils/routing";
import * as userContext from "@/utils/UserContext";
import { UserContextProvider, useUserData } from "@/utils/UserContext";
import { actualUserContext } from "../setup/preload";
import { TrpcTestProviders, testApi } from "../setup/trpc";

const clients: QueryClient[] = [];
let userId = "player";
beforeEach(() => {
  // Bun retains other suites' module mocks; exercise the provider's real cache observers.
  vi.spyOn(userContext, "useUserData").mockImplementation(
    actualUserContext.useUserData,
  );
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation(
    actualUserContext.useUserDataSelector,
  );
  userId = "player";
  vi.spyOn(clerk, "useUser").mockImplementation(
    () => ({ isSignedIn: true, isLoaded: true, user: { id: userId } }) as never,
  );
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
    bfcacheId: "startup-notifications",
  });
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/profile");
  vi.spyOn(mastery, "useMasteryQueueRefresh").mockImplementation(() => {});
  vi.spyOn(refresh, "useRefreshAt").mockImplementation(() => {});
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: testApi.profile,
    comments: testApi.comments,
    tournament: testApi.tournament,
    useUtils: testApi.useUtils,
  });
  getDefaultStore().set(chatMentionsAtom, {});
});
afterEach(() => {
  cleanup();
  for (const qc of clients.splice(0)) qc.clear();
  getDefaultStore().set(chatMentionsAtom, {});
  vi.restoreAllMocks();
});

const muteSettings = [
  { chatMuted: true, mutedConversationIds: [], unmutedTavernIds: [] },
  { chatMuted: false, mutedConversationIds: ["global"], unmutedTavernIds: [] },
];
it.each(muteSettings)(
  "waits for the profile, then delivers a ping whatever is muted (%j)",
  async (mute) => {
    const test = mount({ mute });
    await waitFor(() => expect(test.reads()).toBe(1));
    let pending!: Promise<void>;
    act(() => {
      pending = test.receive({
        type: "pinged",
        conversationId: "global",
        isPublic: true,
      });
    });
    expect(test.showToast).not.toHaveBeenCalled();
    expect(getDefaultStore().get(chatMentionsAtom)).toEqual({});
    await act(async () => {
      test.finish();
      await pending;
    });
    await test.view.findByText("Profile loaded");
    expect(test.showToast).toHaveBeenCalledTimes(1);
    expect(getDefaultStore().get(chatMentionsAtom)).toEqual({ global: 1 });
  },
);

it("retains unmuted startup pings through same-account membership-channel rebinding", async () => {
  const test = mount();
  let pending!: Promise<void>;
  act(() => {
    pending = test.receive({
      type: "pinged",
      conversationId: "global",
      isPublic: true,
    });
  });
  expect(test.showToast).not.toHaveBeenCalled();
  await act(async () => {
    test.finish();
    await pending;
  });
  await test.view.findByText("Profile loaded");
  expect(test.showToast).toHaveBeenCalledTimes(1);
  expect(getDefaultStore().get(chatMentionsAtom)).toEqual({ global: 1 });
});

it.each([0, 1])(
  "reconciles startup inbox activity when the initial snapshot contains %i event messages",
  async (initialCount) => {
    const test = mount({ initialCount, deferredRefresh: true });
    let pending!: Promise<void>;
    act(() => {
      pending = test.receive({ type: "newInbox", conversationId: "private" });
    });
    expect(test.qc.getQueryState(test.key)?.fetchStatus).toBe("fetching");
    expect(test.showToast).not.toHaveBeenCalled();
    await act(async () => {
      test.finish();
    });
    await test.view.findByText("Profile loaded");
    await waitFor(() => expect(test.reads()).toBe(2));
    // Let the provider rebind its membership channels while reconciliation remains pending.
    await act(async () => {
      test.finishRefresh();
      await pending;
    });
    expect(test.inboxCount()).toBe(1);
    expect(test.showToast).toHaveBeenCalledTimes(1);
    expect(test.qc.getQueryState(test.key)?.status).toBe("success");
  },
);

it("retains the authoritative count when the profile includes a message before its socket delivery", async () => {
  const test = mount({ initialCount: 1 });
  await act(async () => {
    test.finish();
  });
  await test.view.findByText("Profile loaded");
  await act(async () => test.receive({ type: "newInbox", conversationId: "private" }));
  expect(test.inboxCount()).toBe(1);
  expect(test.reads()).toBe(2);
  expect(test.showToast).toHaveBeenCalledTimes(1);
});

it.each([0, 1])(
  "reconciles overlapping startup inbox events with initial count %i",
  async (initialCount) => {
    const test = mount({ initialCount, deferredRefresh: true, refreshCounts: [1, 2] });
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = test.receive({ type: "newInbox", conversationId: "private" });
    });
    await act(async () => {
      test.finish();
    });
    await waitFor(() => expect(test.reads()).toBe(2));
    act(() => {
      second = test.receive({ type: "newInbox", conversationId: "private" });
    });
    await act(async () => {
      test.finishRefresh();
    });
    // The in-flight snapshot predates the second event, so it needs another authoritative read.
    await waitFor(() => expect(test.reads()).toBe(3));
    await act(async () => {
      test.finishRefresh();
      await Promise.all([first, second]);
    });
    expect(test.inboxCount()).toBe(2);
    expect(test.showToast).toHaveBeenCalledTimes(2);
  },
);

it("reconciles after an unrelated profile refresh that started before socket delivery", async () => {
  const test = mount({ initialCount: 0, deferredRefresh: true, refreshCounts: [0, 1] });
  await act(async () => {
    test.finish();
  });
  await test.view.findByText("Profile loaded");
  let refresh!: Promise<void>;
  act(() => {
    refresh = test.qc.refetchQueries({ queryKey: test.key });
  });
  await waitFor(() => expect(test.reads()).toBe(2));
  let pending!: Promise<void>;
  act(() => {
    pending = test.receive({ type: "newInbox", conversationId: "private" });
  });
  await waitFor(() => expect(test.reads()).toBe(3));
  await act(async () => {
    test.finishRefresh();
    await Promise.all([refresh, pending]);
  });
  expect(test.inboxCount()).toBe(1);
  expect(test.showToast).toHaveBeenCalledTimes(1);
});

it.each(muteSettings)(
  "lets muted startup inbox activity finish loading normally (%j)",
  async (mute) => {
    const test = mount({ mute });
    let pending!: Promise<void>;
    act(() => {
      pending = test.receive({ type: "newInbox", conversationId: "global" });
    });
    expect(test.qc.getQueryState(test.key)?.fetchStatus).toBe("fetching");
    await act(async () => {
      test.finish();
      await pending;
    });
    await test.view.findByText("Profile loaded");
    expect(test.inboxCount()).toBe(0);
    expect(test.showToast).not.toHaveBeenCalled();
    expect(test.qc.getQueryState(test.key)?.status).toBe("success");
  },
);

it.each(["unmount", "account switch"])(
  "discards pending notifications after %s",
  async (change) => {
    const test = mount();
    let pending!: Promise<void>;
    act(() => {
      pending = test.receive({
        type: "pinged",
        conversationId: "global",
        isPublic: true,
      });
    });
    if (change === "unmount") test.view.unmount();
    else {
      userId = "other-player";
      test.rerender();
    }
    await act(async () => {
      test.finish();
      await pending;
    });
    expect(test.showToast).not.toHaveBeenCalled();
    expect(getDefaultStore().get(chatMentionsAtom)).toEqual({});
  },
);

it.each(["unmount", "account switch"])(
  "discards an inbox toast if %s happens during count reconciliation",
  async (change) => {
    const test = mount({ deferredRefresh: true });
    let pending!: Promise<void>;
    act(() => {
      pending = test.receive({ type: "newInbox", conversationId: "private" });
    });
    await act(async () => {
      test.finish();
    });
    await waitFor(() => expect(test.reads()).toBe(2));
    if (change === "unmount") test.view.unmount();
    else {
      userId = "other-player";
      test.rerender();
    }
    await act(async () => {
      test.finishRefresh();
      await pending;
    });
    expect(test.showToast).not.toHaveBeenCalled();
  },
);

it("settles failed initial profiles without rejecting the pending event handler", async () => {
  const test = mount();
  let pending!: Promise<void>;
  act(() => {
    pending = test.receive({ type: "newInbox", conversationId: "private" });
  });
  await act(async () => {
    test.fail();
    await pending;
  });
  await test.view.findByText("error");
  expect(test.showToast).not.toHaveBeenCalled();
  expect(test.qc.getQueryState(test.key)?.fetchStatus).toBe("idle");
});

function mount(
  options: {
    mute?: {
      chatMuted: boolean;
      mutedConversationIds: string[];
      unmutedTavernIds: string[];
    };
    initialCount?: number;
    deferredRefresh?: boolean;
    refreshCounts?: number[];
  } = {},
) {
  let receive!: (data: object) => Promise<void>;
  vi.spyOn(Pusher, "default").mockImplementation((() => ({
    subscribe: (channel: string) => ({
      bind: (_event: string, handler: typeof receive) => {
        if (channel === "player") receive = handler;
      },
    }),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
    connection: { socket_id: "startup-notifications" },
  })) as never);
  const showToast = vi.spyOn(toast, "showMutationToast").mockImplementation(() => {});
  showToast.mockClear();
  const qc = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  clients.push(qc);
  let reads = 0;
  let finish!: () => void;
  let finishRefresh!: () => void;
  let fail!: () => void;
  const profile = (count = 0) => ({
    userData: {
      userId: "player",
      username: "Profile loaded",
      status: "AWAKE",
      clanId: "clan",
      villageId: "village",
      chatMuted: false,
      mutedConversationIds: [],
      unmutedTavernIds: [],
      ...options.mute,
    },
    notifications: count
      ? [{ href: "/inbox", name: `${count} messages`, notificationCount: count }]
      : [],
    serverTime: Date.now(),
  });
  const trpcClient = testApi.createClient({
    links: [
      () =>
        ({ op }) =>
          observable((observer) => {
            if (op.path !== "profile.getUser") throw new Error(op.path);
            reads++;
            const count =
              reads === 1
                ? options.initialCount
                : (options.refreshCounts?.[reads - 2] ?? 1);
            const send = () => {
              observer.next({ result: { data: profile(count) } });
              observer.complete();
            };
            if (reads === 1) {
              finish = send;
              fail = () =>
                observer.error(TRPCClientError.from(new Error("Profile unavailable")));
            } else if (options.deferredRefresh) finishRefresh = send;
            else send();
          }),
    ],
  });
  const Probe = () => {
    const { data, status } = useUserData();
    return <p>{data?.username ?? status}</p>;
  };
  const Page = () => (
    <TrpcTestProviders client={trpcClient} queryClient={qc}>
      <UserContextProvider initialIsSignedIn>
        <Probe />
      </UserContextProvider>
    </TrpcTestProviders>
  );
  const page = <Page />;
  const view = render(page);
  const key = getQueryKey(testApi.profile.getUser, undefined, "query");
  return {
    qc,
    view,
    key,
    rerender: () => view.rerender(<Page />),
    showToast,
    reads: () => reads,
    receive: (data: object) => receive(data),
    finish: () => finish(),
    finishRefresh: () => finishRefresh(),
    fail: () => fail(),
    inboxCount: () =>
      qc.getQueryData<ReturnType<typeof profile>>(key)?.notifications[0]
        ?.notificationCount ?? 0,
  };
}
