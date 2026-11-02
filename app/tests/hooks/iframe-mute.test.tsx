import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { httpBatchLink } from "@trpc/client";
import { createTRPCReact, getQueryKey } from "@trpc/react-query";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { ReactNode } from "react";
import superjson from "superjson";
import * as clientModule from "@/app/_trpc/client";
import { useIframeMute } from "@/hooks/useIframeMute";
import * as toast from "@/libs/toast";
import type { AppRouter } from "@/server/api/root";
import type { UserWithRelations } from "@/server/api/routers/profile";
import * as userContext from "@/utils/UserContext";
import { prepareUserUpdate, updateUserCache } from "@/utils/userCache";

const testApi = createTRPCReact<AppRouter>();
const key = getQueryKey(testApi.profile.getUser, undefined, "query");
let client: QueryClient;
let success: boolean;
const response = () => ({
  success,
  message: success ? "Updated preferences" : "Failed to update preferences",
  ...(success ? { userPatch: { iframesMuted: true } } : {}),
});
let trpc: ReturnType<typeof testApi.createClient>;

beforeEach(() => {
  success = true;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(key, {
    userData: {
      userId: "iframe-listener",
      iframesMuted: false,
      preferredGeneral1: null,
      preferredGeneral2: null,
    } as NonNullable<UserWithRelations>,
  });
  // Fresh hooks preserve mutation lifecycles after other suites replace the shared API.
  Object.assign(vi.spyOn(clientModule, "api" as never), { profile: testApi.profile });
  trpc = testApi.createClient({ links: [httpBatchLink({
    url: "http://localhost/api/trpc", transformer: superjson,
    fetch: async () => Response.json([{ result: { data: superjson.serialize(response()) } }]),
  })] });
  vi.spyOn(userContext, "useUserDataSelector").mockImplementation((select) => {
    const { data } = testApi.profile.getUser.useQuery(undefined, {
      enabled: false,
      select: (snapshot) => snapshot.userData ? select(snapshot.userData) : undefined,
    });
    return {
      data,
      prepareUserUpdate: () => prepareUserUpdate(client, key),
      updateUser: (patch, mutation) => updateUserCache(client, key, patch, mutation),
    } as ReturnType<typeof userContext.useUserDataSelector> as never;
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  client.clear();
  document.querySelectorAll("iframe[data-user-iframe]").forEach((iframe) => iframe.remove());
  vi.restoreAllMocks();
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <testApi.Provider client={trpc} queryClient={client}>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  </testApi.Provider>
);

it("shares a saved iframe mute preference with mounted and newly opened audio controls", async () => {
  const panel = renderHook(() => useIframeMute(), { wrapper });
  const existingControl = renderHook(() => useIframeMute(), { wrapper });
  act(() => panel.result.current.setIframesMuted(true));

  await waitFor(() => expect(existingControl.result.current.isIframesMuted).toBe(true));
  expect(client.getQueryData<{ userData: { iframesMuted: boolean } }>(key)?.userData.iframesMuted).toBe(true);
  const quickAudio = renderHook(() => useIframeMute(), { wrapper });
  expect(quickAudio.result.current.isIframesMuted).toBe(true);

  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-user-iframe", "true");
  iframe.src = "https://www.youtube-nocookie.com/embed/video";
  document.body.append(iframe);
  await waitFor(() => expect(new URL(iframe.src).searchParams.get("mute")).toBe("1"));
});

it("reports rejected saves without applying a successful profile patch", async () => {
  success = false;
  const panel = renderHook(() => useIframeMute(), { wrapper });
  act(() => panel.result.current.setIframesMuted(true));

  await waitFor(() => expect(toast.showMutationToast).toHaveBeenCalledWith(response()));
  expect(client.getQueryData<{ userData: { iframesMuted: boolean } }>(key)?.userData.iframesMuted).toBe(false);
});
