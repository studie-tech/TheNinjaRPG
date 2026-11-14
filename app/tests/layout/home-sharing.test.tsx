import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import * as navigation from "next/navigation";
import * as Pusher from "pusher-js";
import type { ComponentProps } from "react";
import * as client from "@/app/_trpc/client";
import { HomeSharing } from "@/layout/HomeSharing";
import * as Link from "@/layout/Link";
import { type UserEvent, usePusherHandler } from "@/layout/PusherHandler";
import type UserRequestSystem from "@/layout/UserRequestSystem";
import * as toast from "@/libs/toast";
import * as routing from "@/utils/routing";
import { deferred } from "../setup/deferred";
import { testRouter } from "../setup/router";
import { fakeTrpcClient, TrpcTestProviders, testApi } from "../setup/trpc";

type HomeRequest = ComponentProps<typeof UserRequestSystem>["requests"][number];
type Result = { success: boolean; message: string };
const queryClients: QueryClient[] = [];
const router = testRouter("home-sharing");
const player = (username: string) => ({
  username,
  level: 50,
  rank: "JONIN" as const,
  village: { name: "Konoki" },
});
const request = (overrides: Partial<HomeRequest> = {}): HomeRequest => ({
  id: "invitation",
  senderId: "owner",
  receiverId: "visitor",
  type: "HOME",
  status: "PENDING",
  value: 0,
  relatedId: null,
  pendingAnbuSenderId: null,
  activeHomeReceiverId: "visitor",
  useRankedRules: false,
  spectatable: false,
  createdAt: new Date("2026-10-01T12:00:00Z"),
  sender: player("Owner"),
  receiver: player("Visitor"),
  ...overrides,
});

beforeEach(() => {
  vi.spyOn(navigation, "useRouter").mockReturnValue(router);
  Object.assign(vi.spyOn(client, "api" as never), {
    home: testApi.home,
    profile: testApi.profile,
    comments: testApi.comments,
    tournament: testApi.tournament,
    useUtils: testApi.useUtils,
  });
  vi.spyOn(Link, "default").mockImplementation(({ children, href, onClick }) => (
    <a href={String(href)} onClick={onClick}>
      {children}
    </a>
  ));
});
afterEach(() => {
  cleanup();
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
  vi.restoreAllMocks();
});

const setup = (
  handle: (path: string, input: unknown) => unknown | Promise<unknown>,
  props: Partial<ComponentProps<typeof HomeSharing>> = {},
  listenForInvitations = false,
) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClients.push(queryClient);
  const trpcClient = fakeTrpcClient(handle);
  const onChanged = vi.fn(async () => undefined);
  const wrap = (nextProps: Partial<ComponentProps<typeof HomeSharing>> = {}) => (
    <AppRouterContext.Provider value={router}>
      <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
        {listenForInvitations && <PusherListener />}
        <HomeSharing
          isPublic={false}
          revision={3}
          userId="owner"
          onChanged={onChanged}
          {...props}
          {...nextProps}
        />
      </TrpcTestProviders>
    </AppRouterContext.Provider>
  );
  const view = render(wrap());
  return {
    ...view,
    onChanged,
    rerenderSharing: (nextProps: Partial<ComponentProps<typeof HomeSharing>>) =>
      view.rerender(wrap(nextProps)),
  };
};

const PusherListener = () => {
  usePusherHandler("visitor");
  return null;
};

it("refreshes a mounted home invitation list before showing its incoming invitation toast", async () => {
  let receiveEvent!: (data: UserEvent) => Promise<void>;
  vi.spyOn(Pusher, "default").mockImplementation((() => ({
    subscribe: () => ({
      bind: (_event: string, handler: typeof receiveEvent) => {
        receiveEvent = handler;
      },
    }),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
  })) as never);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/home");
  const showToast = vi
    .spyOn(toast, "showMutationToast")
    .mockImplementation(() => undefined);
  showToast.mockClear();
  const { promise: refreshReady, resolve: finishRefresh } = deferred<void>();
  const query = vi.fn(async () => {
    if (query.mock.calls.length === 1) return [];
    await refreshReady;
    return [request()];
  });
  const view = setup(
    (path) => {
      if (path === "home.getHomeRequests") return query();
      throw new Error(`Unexpected procedure ${path}`);
    },
    { userId: "visitor" },
    true,
  );
  await waitFor(() => expect(view.queryByText("Loading home invitations")).toBeNull());
  expect(query).toHaveBeenCalledTimes(1);
  expect(view.queryByRole("button", { name: "Accept" })).toBeNull();
  try {
    const received = receiveEvent({
      type: "homeInvitation",
      message: "You have been invited to visit a home",
      route: "/home#home-invitations",
      routeText: "View invitation",
    });
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(showToast).not.toHaveBeenCalled();
    await act(async () => {
      finishRefresh();
      await received;
    });
    expect(await view.findByRole("button", { name: "Accept" })).toBeTruthy();
    expect(showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "You have been invited to visit a home" }),
    );
    expect(router.push).not.toHaveBeenCalled();
  } finally {
    finishRefresh();
  }
});

it("sends invitations through the request system and retains rejected input for retry", async () => {
  let requests: HomeRequest[] = [];
  const invite = vi.fn((_input: unknown): Result => {
    if (invite.mock.calls.length === 1)
      return { success: false, message: "Player not found" };
    requests = [request()];
    return { success: true, message: "Home invitation sent" };
  });
  const view = setup((path, input) => {
    if (path === "home.getHomeRequests") return requests;
    if (path === "home.inviteHomeVisitor") return invite(input);
    throw new Error(`Unexpected procedure ${path}`);
  });
  expect(view.getByText(/Invited players can visit after accepting/)).toBeTruthy();
  const username = view.getByRole("textbox", {
    name: "Invite player by username",
  }) as HTMLInputElement;
  fireEvent.change(username, { target: { value: " Visitor " } });
  fireEvent.click(view.getByRole("button", { name: "Invite" }));
  expect((await view.findByText("Player not found")).getAttribute("role")).toBe(
    "status",
  );
  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Invite" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(username.value).toBe(" Visitor ");
  fireEvent.click(view.getByRole("button", { name: "Invite" }));
  expect(await view.findByText("Pending", { selector: "div" })).toBeTruthy();
  expect(invite).toHaveBeenLastCalledWith({ username: "Visitor" });
  expect(username.value).toBe("");
  expect(view.getByRole("button", { name: "Cancel" })).toBeTruthy();
  expect(view.onChanged).not.toHaveBeenCalled();
});

for (const scenario of [
  {
    status: "PENDING",
    userId: "owner",
    action: "Cancel",
    procedure: "cancelHomeInvitation",
    nextStatus: "CANCELLED",
    label: "Cancelled",
  },
  {
    status: "PENDING",
    userId: "visitor",
    action: "Accept",
    procedure: "acceptHomeInvitation",
    nextStatus: "ACCEPTED",
    label: "Accepted",
  },
  {
    status: "PENDING",
    userId: "visitor",
    action: "Reject",
    procedure: "rejectHomeInvitation",
    nextStatus: "REJECTED",
    label: "Rejected",
  },
  {
    status: "ACCEPTED",
    userId: "owner",
    action: "Revoke invitation for Visitor",
    procedure: "cancelHomeInvitation",
    nextStatus: "CANCELLED",
    label: "Cancelled",
  },
] as const) {
  it(`uses the shared ${scenario.action} action and refreshes its saved status`, async () => {
    let current = request({ status: scenario.status });
    const mutation = vi.fn((_input: unknown) => {
      current = { ...current, status: scenario.nextStatus };
      return { success: true, message: "Invitation updated" };
    });
    const view = setup(
      (path, input) => {
        if (path === "home.getHomeRequests") return [current];
        if (path === `home.${scenario.procedure}`) return mutation(input);
        throw new Error(`Unexpected procedure ${path}`);
      },
      { userId: scenario.userId },
    );
    fireEvent.click(await view.findByRole("button", { name: scenario.action }));
    await waitFor(() => expect(mutation).toHaveBeenCalledWith({ id: "invitation" }));
    expect(await view.findByText(scenario.label, { selector: "div" })).toBeTruthy();
    if (scenario.nextStatus === "ACCEPTED") {
      expect(
        (await view.findByRole("link", { name: "View home" })).getAttribute("href"),
      ).toBe("/home/visit/owner");
    } else {
      await waitFor(() =>
        expect(view.queryByRole("button", { name: scenario.action })).toBeNull(),
      );
    }
  });
}

it("shows sent and received history with accepted visit and revoke actions", async () => {
  const view = setup((path) => {
    if (path === "home.getHomeRequests")
      return [
        request({ id: "sent", status: "ACCEPTED" }),
        request({
          id: "received",
          senderId: "host / 2",
          sender: player("Host"),
          receiverId: "owner",
          status: "ACCEPTED",
        }),
        request({ id: "rejected", receiver: player("Declined"), status: "REJECTED" }),
        request({
          id: "cancelled",
          receiver: player("CancelledGuest"),
          status: "CANCELLED",
        }),
      ];
    throw new Error(`Unexpected procedure ${path}`);
  });
  const visit = await view.findByRole("link", { name: "View home" });
  expect(visit.getAttribute("href")).toBe("/home/visit/host%20%2F%202");
  expect(
    view.getByRole("button", { name: "Revoke invitation for Visitor" }),
  ).toBeTruthy();
  expect(view.getAllByRole("table")).toHaveLength(2);
  for (const username of ["Declined", "CancelledGuest"]) {
    const row = view.getByText(username).closest("tr")!;
    expect(within(row).queryByRole("button")).toBeNull();
  }
  expect(view.queryByRole("button", { name: "Accept" })).toBeNull();
});

it("keeps visibility controls pending through revision recovery and retries with the refreshed revision", async () => {
  const { promise: refreshReady, resolve: finishRefresh } = deferred<void>();
  const sharing = vi.fn(
    (_input: unknown): Result =>
      sharing.mock.calls.length === 1
        ? { success: false, message: "Your home changed. Refresh and try again" }
        : { success: true, message: "Your home is public" },
  );
  const onChanged = vi.fn(() => refreshReady);
  const view = setup(
    (path, input) => {
      if (path === "home.getHomeRequests") return [];
      if (path === "home.setHomeSharing") return sharing(input);
      throw new Error(`Unexpected procedure ${path}`);
    },
    { onChanged },
  );
  try {
    fireEvent.click(view.getByRole("button", { name: "Make public" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(view.getByRole("status").textContent).toContain("Your home changed");
    expect(
      (view.getByRole("button", { name: "Make public" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(sharing).toHaveBeenCalledWith({ revision: 3, isPublic: true });
    await act(async () => {
      finishRefresh();
      await refreshReady;
    });
    view.rerenderSharing({ revision: 4 });
    fireEvent.click(view.getByRole("button", { name: "Make public" }));
    await waitFor(() =>
      expect(sharing).toHaveBeenLastCalledWith({ revision: 4, isPublic: true }),
    );
    expect(view.getByRole("status").textContent).toBe("Your home is public");
  } finally {
    finishRefresh();
  }
});

it("shows invitation loading and recovers a failed query from its nearby retry control", async () => {
  const { promise: queryReady, resolve: finishQuery } = deferred<void>();
  let queries = 0;
  const view = setup(async (path) => {
    if (path !== "home.getHomeRequests")
      throw new Error(`Unexpected procedure ${path}`);
    if (++queries === 1) {
      await queryReady;
      throw new Error("Invitations unavailable");
    }
    return [request({ senderId: "host", receiverId: "owner", status: "ACCEPTED" })];
  });
  expect(view.getByText("Loading home invitations")).toBeTruthy();
  await act(async () => {
    finishQuery();
    await queryReady;
  });
  const error = await view.findByRole("alert");
  expect(error.textContent).toContain("Unable to load home invitations");
  expect(view.queryByText("Loading home invitations")).toBeNull();
  fireEvent.click(within(error).getByRole("button", { name: "Retry invitations" }));
  expect(await view.findByRole("link", { name: "View home" })).toBeTruthy();
  expect(view.queryByRole("alert")).toBeNull();
  expect(queries).toBe(2);
});

it("retains invitation input and clears pending state after a transport failure", async () => {
  const invite = vi.fn(() => {
    if (invite.mock.calls.length === 1) throw new Error("Connection lost");
    return { success: true, message: "Home invitation sent" };
  });
  const view = setup((path) => {
    if (path === "home.getHomeRequests") return [];
    if (path === "home.inviteHomeVisitor") return invite();
    throw new Error(`Unexpected procedure ${path}`);
  });
  const username = view.getByRole("textbox", {
    name: "Invite player by username",
  }) as HTMLInputElement;
  fireEvent.change(username, { target: { value: "Visitor" } });
  fireEvent.click(view.getByRole("button", { name: "Invite" }));
  await waitFor(() =>
    expect(view.getByRole("status").textContent).toContain("Connection lost"),
  );
  expect(username.value).toBe("Visitor");
  expect(
    (view.getByRole("button", { name: "Invite" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.click(view.getByRole("button", { name: "Invite" }));
  await waitFor(() =>
    expect(view.getByRole("status").textContent).toBe("Home invitation sent"),
  );
  expect(username.value).toBe("");
});
