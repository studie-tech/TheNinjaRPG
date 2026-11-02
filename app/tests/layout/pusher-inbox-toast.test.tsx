import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createTRPCReact } from "@trpc/react-query";
import * as navigation from "next/navigation";
import * as Pusher from "pusher-js";
import type { PropsWithChildren } from "react";
import type { AppRouter } from "@/api/root";
import * as client from "@/app/_trpc/client";
import { type UserEvent, usePusherHandler } from "@/layout/PusherHandler";
import * as toast from "@/libs/toast";
import * as routing from "@/utils/routing";
import { ensureDom } from "../setup/dom.mjs";

const testApi = createTRPCReact<AppRouter>();
const queryClients: QueryClient[] = [];
const router = {
  back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), push: vi.fn(),
  replace: vi.fn(), prefetch: vi.fn(), bfcacheId: "pusher-inbox",
};

beforeEach(() => {
  ensureDom();
  vi.spyOn(navigation, "useRouter").mockReturnValue(router);
  Object.assign(vi.spyOn(client, "api" as never), { useUtils: testApi.useUtils });
});
afterEach(() => {
  cleanup();
  for (const queryClient of queryClients.splice(0)) queryClient.clear();
  vi.restoreAllMocks();
});

it("suppresses the inbox toast from the page the user is on, not the one they subscribed on", async () => {
  let receiveEvent!: (data: UserEvent) => Promise<void>;
  vi.spyOn(Pusher, "default").mockImplementation(function () {
    return {
      subscribe: () => ({ bind: (_event: string, handler: typeof receiveEvent) => { receiveEvent = handler; } }),
      unsubscribe: vi.fn(), disconnect: vi.fn(),
    };
  } as never);
  const showToast = vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  let pathname = "/profile";
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);

  const queryClient = new QueryClient();
  queryClients.push(queryClient);
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <testApi.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </testApi.Provider>
  );
  const view = renderHook(() => usePusherHandler("player"), { wrapper });

  pathname = "/inbox";
  view.rerender();
  await act(async () => receiveEvent({ type: "newInbox" }));
  expect(showToast).not.toHaveBeenCalled();

  pathname = "/profile";
  view.rerender();
  await act(async () => receiveEvent({ type: "newInbox" }));
  expect(showToast).toHaveBeenCalledTimes(1);
});
