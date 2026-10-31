import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { afterEach, expect, it, vi } from "bun:test";
import { getDefaultStore } from "jotai";
import { chatMutePendingAtom } from "@/libs/chatPanel";
import type { ReactNode } from "react";
import superjson from "superjson";
import type { AppRouter } from "@/api/root";
import * as clientModule from "@/app/_trpc/client";
import { MAX_MUTED_CONVERSATIONS } from "@/drizzle/constants";
import { useChatMutes } from "@/hooks/useChatMutes";
import * as toast from "@/libs/toast";
import * as userContext from "@/utils/UserContext";

const testApi = createTRPCReact<AppRouter>();
afterEach(() => { cleanup(); getDefaultStore().set(chatMutePendingAtom, {}); vi.restoreAllMocks(); });

function setup(ids: string[] = []) {
  let respond!: (value: { success: boolean; message: string } | Error) => void;
  const fetch = vi.fn(async () => {
    const value = await new Promise<{ success: boolean; message: string } | Error>((resolve) => { respond = resolve; });
    if (value instanceof Error) throw value;
    return Response.json([{ result: { data: superjson.serialize(value) } }]);
  });
  Object.assign(vi.spyOn(clientModule, "api" as never), { profile: testApi.profile });
  let data = { userId: "actor", chatMuted: false, mutedConversationIds: ids };
  const updateUser = vi.fn(async (patch: unknown) => {
    const next = typeof patch === "function" ? patch(data) : patch;
    data = { ...data, ...next };
  });
  vi.spyOn(userContext, "useUserData").mockImplementation(() => ({ data, updateUser }) as never);
  const feedback = vi.spyOn(toast, "showMutationToast").mockImplementation(() => {});
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const trpc = testApi.createClient({ links: [httpBatchLink({ url: "http://localhost/api/trpc", transformer: superjson, fetch })] });
  const hook = renderHook(() => ({ ...useChatMutes(), second: useChatMutes() }), { wrapper: ({ children }: { children: ReactNode }) => (
    <testApi.Provider client={trpc} queryClient={queryClient}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></testApi.Provider>
  ) });
  return { ...hook, updateUser, fetch, feedback, switchAccount: (userId: string) => { data = { ...data, userId }; }, respond: (value: { success: boolean; message: string } | Error) => respond(value) };
}

it.each(["saved", "rejected", "network"])("keeps mute state consistent when the save is %s", async (outcome) => {
  const hook = setup();
  act(() => hook.result.current.setChatMuted(true));
  await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(1));
  expect(hook.updateUser).not.toHaveBeenCalled();
  act(() => hook.respond(outcome === "network" ? new Error("Offline") : { success: outcome === "saved", message: outcome }));
  await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  if (outcome === "saved") {
    expect(hook.updateUser).toHaveBeenCalledTimes(1);
    const patch = hook.updateUser.mock.calls[0]?.[0] as unknown as (user: { userId: string }) => unknown;
    expect(patch({ userId: "actor" })).toEqual({ chatMuted: true });
    expect(patch({ userId: "different-account" })).toBeUndefined();
  } else {
    expect(hook.updateUser).not.toHaveBeenCalled();
    if (outcome === "rejected") expect(hook.feedback).toHaveBeenCalled();
  }
});

it("blocks an extra mute at the limit while allowing an existing mute to be removed", async () => {
  const hook = setup(Array.from({ length: MAX_MUTED_CONVERSATIONS }, (_, i) => `chat-${i}`));
  act(() => hook.result.current.toggleMute("extra"));
  expect(hook.fetch).not.toHaveBeenCalled();
  expect(hook.feedback).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining(String(MAX_MUTED_CONVERSATIONS)) }));
  act(() => hook.result.current.toggleMute("chat-0"));
  await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(1));
  act(() => hook.respond({ success: true, message: "Saved" }));
  await waitFor(() => expect(hook.updateUser).toHaveBeenCalledTimes(1));
});

it("reconciles a successful mute even when chat closes before the response", async () => {
  const hook = setup();
  act(() => hook.result.current.setChatMuted(true));
  await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(1));
  hook.unmount();
  act(() => hook.respond({ success: true, message: "Saved" }));
  await waitFor(() => expect(hook.updateUser).toHaveBeenCalledTimes(1));
});


it("serializes mute lists across chat surfaces, including clicks before rerender", async () => {
  const hook = setup();
  act(() => {
    hook.result.current.toggleMute("tavern");
    hook.result.current.second.toggleMute("inbox");
  });
  await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(1));
  expect(hook.result.current.second.isPending).toBe(true);
  act(() => hook.respond({ success: true, message: "Saved" }));
  await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  hook.rerender();
  expect(hook.result.current.second.isMuted("tavern")).toBe(true);
  act(() => hook.result.current.second.toggleMute("inbox"));
  await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(2));
  act(() => hook.respond({ success: true, message: "Saved" }));
  await waitFor(() => expect(hook.result.current.second.isPending).toBe(false));
  hook.rerender();
  expect(hook.result.current.isMuted("tavern")).toBe(true);
  expect(hook.result.current.isMuted("inbox")).toBe(true);
});


it("captures the saving account before mutation callbacks and releases its shared lock after a switch", async () => {
  const hook = setup();
  act(() => {
    hook.result.current.setChatMuted(true);
    hook.switchAccount("other-account");
    hook.rerender();
  });
  await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(1));
  act(() => hook.respond({ success: true, message: "Saved" }));
  await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  expect(hook.result.current.chatMuted).toBe(false);
  expect(getDefaultStore().get(chatMutePendingAtom)).toEqual({});
});
