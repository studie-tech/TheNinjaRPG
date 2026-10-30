import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { Clerk } from "@clerk/shared/types";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import superjson from "superjson";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import type { RouterOutputs } from "@/app/_trpc/client";
import NotifyUsers from "@/app/[shell]/event/page";
import * as ContentBox from "@/layout/ContentBox";
import * as RichInput from "@/layout/RichInput";
import * as SliderField from "@/layout/SliderField";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import * as toastUi from "@/components/ui/use-toast";
import * as toast from "@/libs/toast";
import { createTrpcSession, SESSION_CHANGED_MESSAGE, trpcSessionLink } from "@/libs/trpcSession";
import * as UserContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";
import { actualShowMutationToast } from "../setup/preload";

const key = [["profile", "getUser"], { type: "query" }];
type Result = RouterOutputs["misc"]["submitNotification"];
type Success = (data: Result, variables: unknown, revision: number | undefined) => Promise<void>;
let onSuccess: Success;
const history = vi.fn(async () => undefined);
const shown = Object.assign(vi.fn((_options: Parameters<typeof toastUi.toast>[0]) => "test"), toastUi.toast);
const snapshot = () => ({
  userData: { userId: "actor", username: "Actor", role: "OWNER", money: 100, unreadNotifications: 0 },
  notifications: [{ href: "/inbox", name: "Inbox", color: "blue" }],
});
const result: Result = {
  success: true,
  message: "Notification sent",
  userPatch: { unreadNotifications: 0 },
  announcements: ["An <strong>event</strong> starts tomorrow."],
};
const clients: QueryClient[] = [];

beforeEach(() => {
  history.mockClear();
  shown.mockClear();
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(RichInput, "default").mockImplementation(() => <></>);
  vi.spyOn(SliderField, "default").mockImplementation(() => <></>);
  vi.spyOn(UserSearchSelect, "default").mockImplementation(() => <></>);
  vi.spyOn(toast, "showMutationToast").mockImplementation(actualShowMutationToast);
  vi.spyOn(toastUi, "toast").mockImplementation(shown);
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ misc: { getPreviousNotifications: { invalidate: history } } }),
    misc: {
      getSetting: { useQuery: () => ({}) },
      setEventGameSetting: { useMutation: () => ({}) },
      getPreviousNotifications: { useInfiniteQuery: () => ({}) },
      submitNotification: { useMutation: (options: { onSuccess: Success }) => {
        onSuccess = options.onSuccess;
        return {};
      } },
    },
    staff: {
      throwError: { useMutation: () => ({}) },
      throwTrpcError: { useMutation: () => ({}) },
    },
  });
});

afterEach(() => {
  for (const queryClient of clients.splice(0)) queryClient.clear();
  vi.restoreAllMocks();
});

const setup = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(queryClient);
  queryClient.setQueryData(key, snapshot());
  const read = vi.fn(async () => snapshot());
  const observer = new QueryObserver(queryClient, { queryKey: key, staleTime: Infinity, queryFn: read });
  const unsubscribe = observer.subscribe(() => undefined);
  const updateUser = vi.fn((patch, options) => updateUserCache(queryClient, key, patch, options));
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: snapshot().userData,
    prepareUserUpdate: () => prepareUserUpdate(queryClient, key),
    updateUser,
  } as never);
  renderToStaticMarkup(<NotifyUsers />);
  return { queryClient, read, updateUser, unsubscribe };
};

it.each(["idle", "changed", "fetching", "error"] as const)("delivers consumed announcements once with a %s profile", async (state) => {
  const test = setup();
  let revision = prepareUserUpdate(test.queryClient, key);
  if (state === "changed")
    test.queryClient.setQueryData(key, { ...snapshot(), userData: { ...snapshot().userData, money: 101 } });
  if (state === "fetching") {
    const pending = test.queryClient.refetchQueries({ queryKey: key });
    revision = prepareUserUpdate(test.queryClient, key);
    await pending;
    test.read.mockClear();
  }
  if (state === "error") {
    test.read.mockRejectedValueOnce(new Error("Profile unavailable"));
    await test.queryClient.refetchQueries({ queryKey: key });
    revision = prepareUserUpdate(test.queryClient, key);
    test.read.mockClear();
  }
  await onSuccess(result, {}, revision);
  const announcements = shown.mock.calls
    .map(([message]) => message)
    .filter((message) => message.title === "Notification!");
  expect(announcements).toHaveLength(1);
  expect(renderToStaticMarkup(announcements[0]!.description as React.ReactElement)).toContain("An <strong>event</strong> starts tomorrow.");
  expect(test.read).toHaveBeenCalledTimes(state === "idle" ? 0 : 1);
  expect(test.queryClient.getQueryData(key)).toMatchObject({ notifications: snapshot().notifications });
  expect(history).toHaveBeenCalledTimes(1);
  test.unsubscribe();
});

it("recovers unconfirmed announcements through the canonical profile without inventing a toast", async () => {
  const test = setup();
  await onSuccess({ success: true, message: "Notification sent" }, {}, prepareUserUpdate(test.queryClient, key));
  expect(test.read).toHaveBeenCalledTimes(1);
  expect(shown).toHaveBeenCalledTimes(1);
  test.unsubscribe();
});

it("delivers consumed announcements before awaiting profile reconciliation", async () => {
  const test = setup();
  let finish!: () => void;
  test.updateUser.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const pending = onSuccess(result, {}, undefined);
  expect(shown.mock.calls.filter(([message]) => message.title === "Notification!")).toHaveLength(1);
  finish();
  await pending;
  test.unsubscribe();
});

it.each(["accepted", "switch", "sign-out", "lost"] as const)("delivers only an accepted transport response (%s)", async (outcome) => {
  const test = setup();
  const revision = prepareUserUpdate(test.queryClient, key);
  const session = (id: string) => ({ id, getToken: async () => id }) as NonNullable<Clerk["session"]>;
  const clerk: Pick<Clerk, "session"> = { session: session("actor") };
  const scope = createTrpcSession(clerk);
  let finish!: () => void;
  let started!: () => void;
  const dispatched = new Promise<void>((resolve) => { started = resolve; });
  const transport = createTRPCClient<AppRouter>({ links: [trpcSessionLink(scope), httpBatchLink({
    url: "http://localhost/api/trpc", transformer: superjson, headers: scope.headers,
    fetch: async () => {
      started();
      await new Promise<void>((resolve) => { finish = resolve; });
      if (outcome === "lost") throw new Error("Response lost after commit");
      return Response.json([{ result: { data: superjson.serialize(result) } }]);
    },
  })] });
  const failed = vi.fn();
  const pending = transport.misc.submitNotification.mutate({ content: "An event starts tomorrow.", senderId: "actor" })
    .then((data) => onSuccess(data, {}, revision), failed);
  await dispatched;
  if (outcome === "switch" || outcome === "sign-out") {
    clerk.session = outcome === "switch" ? session("other") : null;
    scope.observeSession(clerk.session?.id ?? null);
  }
  finish();
  await pending;
  expect(shown.mock.calls.filter(([message]) => message.title === "Notification!")).toHaveLength(outcome === "accepted" ? 1 : 0);
  if (outcome === "accepted") expect(failed).not.toHaveBeenCalled();
  else {
    expect(failed).toHaveBeenCalledTimes(1);
    expect(failed.mock.calls[0]![0].message).toContain(outcome === "lost" ? "Response lost" : SESSION_CHANGED_MESSAGE);
    expect(test.updateUser).not.toHaveBeenCalled();
  }
  test.unsubscribe();
});

it("does not deliver announcements or change the profile after a rejected send", async () => {
  const test = setup();
  await onSuccess({ success: false, message: "Not allowed" }, {}, prepareUserUpdate(test.queryClient, key));
  expect(test.updateUser).not.toHaveBeenCalled();
  expect(shown).toHaveBeenCalledWith(expect.objectContaining({ title: "Error", description: "Not allowed" }));
  test.unsubscribe();
});

it("keeps consumed announcements separate from action notifications and silent success messages", () => {
  const response = { success: true, message: "OK", announcements: ["Consumed feedback"], notifications: ["Objective feedback"] };
  actualShowMutationToast(response);
  expect(shown).toHaveBeenCalledTimes(1);
  expect(shown).toHaveBeenCalledWith(expect.objectContaining({ title: "Notification!" }));
});
