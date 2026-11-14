import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { observable } from "@trpc/server/observable";
import { getDefaultStore } from "jotai";
import * as navigation from "next/navigation";
import * as Pusher from "pusher-js";
import * as client from "@/app/_trpc/client";
import { useTavernActivity } from "@/hooks/useTavernActivity";
import * as taverns from "@/hooks/useTaverns";
import { ParentalControls } from "@/layout/ParentalControls";
import { usePusherHandler } from "@/layout/PusherHandler";
import { chatTavernActivityAtom, chatViewedConversationsAtom } from "@/libs/chatPanel";
import * as toast from "@/libs/toast";
import * as routing from "@/utils/routing";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { TrpcTestProviders, testApi } from "../setup/trpc";

const store = getDefaultStore();
const clients: QueryClient[] = [];
type Handler = (event: {
  type?: string;
  message?: string;
  fromId?: string;
  commentId?: string;
}) => void;

beforeEach(() => {
  installBrowserGlobals({ resizeObserver: true });
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/profile");
  vi.spyOn(taverns, "useTaverns").mockReturnValue({
    availTaverns: ["Global"],
    isLoading: false,
  } as never);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  Object.assign(vi.spyOn(client, "api" as never), {
    comments: testApi.comments,
    profile: testApi.profile,
    parentalControls: testApi.parentalControls,
    tournament: testApi.tournament,
    useUtils: testApi.useUtils,
  });
});

afterEach(() => {
  cleanup();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  store.set(chatTavernActivityAtom, {});
  store.set(chatViewedConversationsAtom, {});
  restoreBrowserGlobals();
  vi.restoreAllMocks();
});

for (const source of ["save", "event"] as const) {
  it.each([false, true])(
    `${source} reconciles tavern subscriptions and unread activity when access starts blocked=%s`,
    async (startingBlocked) => {
      let blocked = startingBlocked;
      let version = 0;
      const handlers = new Map<string, Handler>();
      vi.spyOn(Pusher, "default").mockImplementation((() => ({
        subscribe: (id: string) => ({
          bind: (_name: string, handler: Handler) => handlers.set(id, handler),
          unbind: () => handlers.delete(id),
        }),
        unsubscribe: (id: string) => handlers.delete(id),
        disconnect: vi.fn(),
      })) as never);
      const readTaverns = vi.fn(() =>
        blocked ? [] : [{ id: "global", title: "Global" }],
      );
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      });
      clients.push(queryClient);
      const trpcClient = testApi.createClient({
        links: [
          () =>
            ({ op }) =>
              observable((observer) => {
                let data: unknown;
                if (op.path === "comments.getTavernIds") data = readTaverns();
                else if (op.path === "comments.fetchConversationComment")
                  data = { id: "new" };
                else if (op.path === "parentalControls.get") {
                  data = {
                    enabled: true,
                    hasPin: true,
                    tavernDisabled: blocked,
                    privateMessages: "EVERYONE",
                    approvedPlayers: [],
                    version,
                  };
                } else if (op.path === "parentalControls.save") {
                  blocked = (op.input as { tavernDisabled: boolean }).tavernDisabled;
                  version++;
                  data = { success: true, message: "Saved parental controls" };
                } else throw new Error(`Unexpected procedure ${op.path}`);
                observer.next({ result: { data } });
                observer.complete();
              }),
        ],
      });
      const user = {
        userId: "me",
        level: 50,
        isBanned: false,
        isSilenced: false,
        chatMuted: false,
        mutedConversationIds: [],
        unmutedTavernIds: ["global"],
      } as never;
      const LiveTab = () => {
        const pusher = usePusherHandler("me");
        useTavernActivity(pusher, user);
        return source === "save" ? <ParentalControls /> : null;
      };
      const view = render(
        <TrpcTestProviders client={trpcClient} queryClient={queryClient}>
          <LiveTab />
        </TrpcTestProviders>,
      );
      await waitFor(() => expect(readTaverns).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(handlers.has("global")).toBe(!startingBlocked));
      if (!startingBlocked) {
        await act(async () =>
          handlers.get("global")?.({
            message: "new",
            fromId: "other",
            commentId: "new",
          }),
        );
        await waitFor(() =>
          expect(store.get(chatTavernActivityAtom)).toEqual({ global: 1 }),
        );
      }

      if (source === "save") {
        fireEvent.click(
          await view.findByRole("switch", { name: "Disable tavern access" }),
        );
        fireEvent.change(view.getByLabelText("Parent PIN"), {
          target: { value: "123456" },
        });
        fireEvent.click(view.getByRole("button", { name: "Save parental controls" }));
        await waitFor(() => expect(blocked).toBe(!startingBlocked));
      } else {
        blocked = !startingBlocked;
        await act(async () =>
          handlers.get("me")?.({ type: "parentalControlsChanged" }),
        );
      }
      await waitFor(() => expect(readTaverns).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(handlers.has("global")).toBe(startingBlocked));
      expect(store.get(chatTavernActivityAtom)).toEqual({});
      if (startingBlocked) {
        await act(async () =>
          handlers.get("global")?.({
            message: "new",
            fromId: "other",
            commentId: "new",
          }),
        );
        await waitFor(() =>
          expect(store.get(chatTavernActivityAtom)).toEqual({ global: 1 }),
        );
      }
    },
  );
}
