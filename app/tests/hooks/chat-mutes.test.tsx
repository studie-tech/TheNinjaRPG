import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { MutationCache, QueryClient } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { afterEach, expect, it, vi } from "bun:test";
import { getDefaultStore } from "jotai";
import { chatMutePendingAtom } from "@/libs/chatPanel";
import type { ReactNode } from "react";
import superjson from "superjson";
import * as clientModule from "@/app/_trpc/client";
import { MAX_MUTED_CONVERSATIONS } from "@/drizzle/constants";
import { useChatMutes } from "@/hooks/useChatMutes";
import * as toast from "@/libs/toast";
import { mergeQueryChanges } from "@/utils/queryCache";
import * as userContext from "@/utils/UserContext";
import { testApi, TrpcTestProviders } from "../setup/trpc";

type PreferenceResponse = {
  success: boolean;
  message: string;
  userPatch?: {
    chatMuted?: boolean;
    mutedConversationIds?: string[];
    unmutedTavernIds?: string[];
  };
};
afterEach(() => {
  cleanup();
  getDefaultStore().set(chatMutePendingAtom, {});
  vi.restoreAllMocks();
});

function setup(
  ids: string[] = [],
  rejectBeforeMutation = false,
  taverns: { unmutedTavernIds?: string[] } = { unmutedTavernIds: [] },
) {
  let respond!: (value: PreferenceResponse | Error) => void;
  const fetch = vi.fn(async () => {
    const value = await new Promise<PreferenceResponse | Error>((resolve) => {
      respond = resolve;
    });
    if (value instanceof Error) throw value;
    return Response.json([{ result: { data: superjson.serialize(value) } }]);
  });
  Object.assign(vi.spyOn(clientModule, "api" as never), { profile: testApi.profile });
  let data = {
    userId: "actor",
    chatMuted: false,
    mutedConversationIds: ids,
    ...taverns,
  };
  const updateUser = vi.fn(async (patch: unknown, _options?: { revision?: number }) => {
    const next = typeof patch === "function" ? patch(data) : patch;
    data = { ...data, ...next };
  });
  const prepareUserUpdate = vi.fn(() => 7);
  vi.spyOn(userContext, "useUserData").mockImplementation(
    () => ({ data, prepareUserUpdate, updateUser }) as never,
  );
  const feedback = vi.spyOn(toast, "showMutationToast").mockImplementation(() => {});
  const queryClient = new QueryClient({
    mutationCache: new MutationCache({
      onMutate: () => {
        if (rejectBeforeMutation) throw new Error("Session changed");
      },
    }),
    defaultOptions: { mutations: { retry: false } },
  });
  const trpc = testApi.createClient({
    links: [
      httpBatchLink({
        url: "http://localhost/api/trpc",
        transformer: superjson,
        fetch,
      }),
    ],
  });
  const hook = renderHook(() => ({ ...useChatMutes(), second: useChatMutes() }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <TrpcTestProviders client={trpc} queryClient={queryClient}>
        {children}
      </TrpcTestProviders>
    ),
  });
  return {
    ...hook,
    updateUser,
    fetch,
    feedback,
    switchAccount: (userId: string) => {
      data = { ...data, userId };
    },
    respond: (value: PreferenceResponse | Error) => respond(value),
  };
}

it.each(["saved", "rejected", "network"])(
  "keeps mute state consistent when the save is %s",
  async (outcome) => {
    const hook = setup();
    act(() => hook.result.current.setChatMuted(true));
    await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(1));
    expect(hook.updateUser).not.toHaveBeenCalled();
    act(() =>
      hook.respond(
        outcome === "network"
          ? new Error("Offline")
          : {
              success: outcome === "saved",
              message: outcome,
              userPatch: { chatMuted: false },
            },
      ),
    );
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));
    if (outcome === "saved") {
      expect(hook.updateUser).toHaveBeenCalledTimes(1);
      const patch = hook.updateUser.mock.calls[0]?.[0] as unknown as (user: {
        userId: string;
      }) => unknown;
      expect(patch({ userId: "actor" })).toEqual({ chatMuted: false });
      expect(hook.updateUser.mock.calls[0]?.[1]).toEqual({ revision: 7 });
      expect(patch({ userId: "different-account" })).toBeUndefined();
    } else {
      expect(hook.updateUser).not.toHaveBeenCalled();
      if (outcome === "rejected") expect(hook.feedback).toHaveBeenCalled();
    }
  },
);

it("blocks an extra mute at the limit while allowing an existing mute to be removed", async () => {
  const hook = setup(
    Array.from({ length: MAX_MUTED_CONVERSATIONS }, (_, i) => `chat-${i}`),
  );
  act(() => hook.result.current.toggleMute("extra"));
  expect(hook.fetch).not.toHaveBeenCalled();
  expect(hook.feedback).toHaveBeenCalledWith(
    expect.objectContaining({
      success: false,
      message: expect.stringContaining(String(MAX_MUTED_CONVERSATIONS)),
    }),
  );
  act(() => hook.result.current.toggleMute("chat-0"));
  await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(1));
  act(() =>
    hook.respond({
      success: true,
      message: "Saved",
      userPatch: {
        mutedConversationIds: Array.from(
          { length: MAX_MUTED_CONVERSATIONS - 1 },
          (_, i) => `chat-${i + 1}`,
        ),
      },
    }),
  );
  await waitFor(() => expect(hook.updateUser).toHaveBeenCalledTimes(1));
});

it("reconciles a successful mute even when chat closes before the response", async () => {
  const hook = setup();
  act(() => hook.result.current.setChatMuted(true));
  await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(1));
  hook.unmount();
  act(() =>
    hook.respond({ success: true, message: "Saved", userPatch: { chatMuted: true } }),
  );
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
  act(() =>
    hook.respond({
      success: true,
      message: "Saved",
      userPatch: { mutedConversationIds: ["tavern"] },
    }),
  );
  await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  hook.rerender();
  expect(hook.result.current.second.isMuted("tavern")).toBe(true);
  act(() => hook.result.current.second.toggleMute("inbox"));
  await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(2));
  act(() =>
    hook.respond({
      success: true,
      message: "Saved",
      userPatch: { mutedConversationIds: ["tavern", "inbox"] },
    }),
  );
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
  act(() =>
    hook.respond({ success: true, message: "Saved", userPatch: { chatMuted: true } }),
  );
  await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  expect(hook.result.current.chatMuted).toBe(false);
  expect(getDefaultStore().get(chatMutePendingAtom)).toEqual({});
});

it("releases the mute lock when the global session guard rejects before local onMutate", async () => {
  const hook = setup([], true);
  act(() => hook.result.current.setChatMuted(true));
  await waitFor(() => expect(getDefaultStore().get(chatMutePendingAtom)).toEqual({}));
  expect(hook.fetch).not.toHaveBeenCalled();
  expect(hook.updateUser).not.toHaveBeenCalled();
  expect(hook.result.current.isPending).toBe(false);
});

it("unmutes a tavern for a profile without the unmute list", async () => {
  const hook = setup([], false, {});
  expect(hook.result.current.isTavernSilenced("global")).toBe(true);
  act(() => hook.result.current.toggleTavernMute("global"));
  await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(1));
  const request = hook.fetch.mock.calls[0] as unknown as [string, { body: string }];
  expect(JSON.parse(request[1].body)).toEqual({
    0: { json: { unmutedTavernIds: ["global"] } },
  });
  act(() =>
    hook.respond({
      success: true,
      message: "Saved",
      userPatch: { unmutedTavernIds: ["global"] },
    }),
  );
  await waitFor(() => expect(hook.updateUser).toHaveBeenCalledTimes(1));
  hook.rerender();
  expect(hook.result.current.isTavernSilenced("global")).toBe(false);
  const patch = hook.updateUser.mock.calls[0]?.[0] as unknown as (user: {
    userId: string;
  }) => { unmutedTavernIds: string[] };
  const cached: { userId: string; unmutedTavernIds?: string[] } = { userId: "actor" };
  expect(mergeQueryChanges(cached, patch(cached))?.unmutedTavernIds).toEqual([
    "global",
  ]);
});

it("starts taverns muted and saves the ones the player unmutes", async () => {
  const hook = setup();
  expect(hook.result.current.isTavernSilenced("global")).toBe(true);
  act(() => hook.result.current.toggleTavernMute("global"));
  await waitFor(() => expect(hook.fetch).toHaveBeenCalledTimes(1));
  const request = hook.fetch.mock.calls[0] as unknown as [string, { body: string }];
  expect(JSON.parse(request[1].body)).toEqual({
    0: { json: { unmutedTavernIds: ["global"] } },
  });
  act(() =>
    hook.respond({
      success: true,
      message: "Saved",
      userPatch: { unmutedTavernIds: ["global"] },
    }),
  );
  await waitFor(() => expect(hook.updateUser).toHaveBeenCalledTimes(1));
  hook.rerender();
  expect(hook.result.current.isTavernSilenced("global")).toBe(false);
});
