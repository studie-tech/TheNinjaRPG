import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { getQueryKey } from "@trpc/react-query";
import * as navigation from "next/navigation";
import * as Pusher from "pusher-js";
import type { PropsWithChildren } from "react";
import * as client from "@/app/_trpc/client";
import { BATTLE_ALERT_SFX_URL } from "@/drizzle/constants";
import type { UserEvent } from "@/layout/PusherHandler";
import { usePusherHandler } from "@/layout/PusherHandler";
import * as preferences from "@/libs/audioPreferences";
import * as audio from "@/utils/audio";
import * as routing from "@/utils/routing";
import { testRouter } from "../setup/router";
import { TrpcTestProviders, testApi } from "../setup/trpc";

const clients: QueryClient[] = [];

/** Let the hook's on-demand pusher-js import settle, so its channels are bound. */
const connectPusher = () =>
  act(async () => {
    await import("pusher-js");
  });
const hiddenDescriptor = Object.getOwnPropertyDescriptor(document, "hidden");
let hidden = true;
beforeEach(() => {
  hidden = true;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  vi.spyOn(navigation, "useRouter").mockReturnValue(testRouter("battle-sound"));
  vi.spyOn(routing, "usePublicPathname").mockReturnValue("/profile");
  vi.spyOn(routing, "pushToCombat").mockImplementation(() => undefined);
  vi.spyOn(audio, "preloadAudioBuffers").mockResolvedValue(undefined);
  vi.spyOn(audio, "unlockAudioPlayback").mockImplementation(() => undefined);
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: testApi.profile,
    comments: testApi.comments,
    tournament: testApi.tournament,
    useUtils: testApi.useUtils,
  });
  localStorage.setItem("sfxVolume", "0.35");
});
afterEach(() => {
  cleanup();
  for (const qc of clients.splice(0)) qc.clear();
  vi.restoreAllMocks();
  localStorage.removeItem("sfxVolume");
  if (hiddenDescriptor) Object.defineProperty(document, "hidden", hiddenDescriptor);
  else Reflect.deleteProperty(document, "hidden");
});

it("preloads and unlocks the alert, plays once at saved volume, and enters combat", async () => {
  const test = await mount();
  expect(audio.preloadAudioBuffers).toHaveBeenCalledWith([BATTLE_ALERT_SFX_URL]);
  act(() => document.dispatchEvent(new window.Event("click")));
  expect(audio.unlockAudioPlayback).toHaveBeenCalledTimes(1);
  await act(async () => Promise.all([test.receive(), test.receive()]));
  expect(test.play).toHaveBeenCalledTimes(1);
  expect(test.play).toHaveBeenCalledWith(BATTLE_ALERT_SFX_URL, 0.35);
  expect(test.qc.getQueryData(test.key)).toMatchObject({
    userData: { status: "BATTLE", battleId: "battle-one" },
  });
  expect(routing.pushToCombat).toHaveBeenCalled();
  test.view.rerender({ villageId: "another-village" });
  await act(async () => test.receive());
  expect(test.play).toHaveBeenCalledTimes(1);
  await act(async () => test.receive({ battleId: "battle-two" }));
  expect(test.play).toHaveBeenCalledTimes(2);
});

it.each([
  { visible: true, sfxOn: true, isDefender: true },
  { visible: false, sfxOn: false, isDefender: true },
  { visible: false, sfxOn: true, isDefender: false },
  { visible: false, sfxOn: true, isDefender: undefined },
])("keeps admission silent for %j", async ({ visible, sfxOn, isDefender }) => {
  hidden = !visible;
  const test = await mount(sfxOn);
  await act(async () => test.receive({ isDefender }));
  expect(test.play).not.toHaveBeenCalled();
  expect(test.qc.getQueryData(test.key)).toMatchObject({
    userData: { status: "BATTLE" },
  });
});

it("does not replay a foreground admission when its duplicate arrives in the background", async () => {
  const test = await mount();
  hidden = false;
  await act(async () => test.receive());
  hidden = true;
  await act(async () => test.receive());
  expect(test.play).not.toHaveBeenCalled();
});

it("reads the current effects preference for each event", async () => {
  const test = await mount();
  await act(async () => test.receive());
  test.setProfile(false);
  await act(async () => test.receive({ battleId: "battle-two" }));
  expect(test.play).toHaveBeenCalledTimes(1);
});

it("honors the local playback preference", async () => {
  const test = await mount();
  vi.spyOn(preferences, "getAudioPreference").mockReturnValue(false);
  await act(async () => test.receive());
  expect(test.play).not.toHaveBeenCalled();
});

it.each(["unmount", "account switch"])(
  "ignores stale admissions after %s",
  async (change) => {
    const test = await mount();
    if (change === "unmount") test.view.unmount();
    else test.setProfile(true, "another-player");
    await act(async () => test.receive());
    expect(test.play).not.toHaveBeenCalled();
  },
);

it("opens no connection without a player or after an unmount during the client download", async () => {
  const construct = vi.spyOn(Pusher, "default").mockImplementation((() => ({
    subscribe: () => ({ bind: () => undefined }),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
    connection: { socket_id: "tab" },
  })) as never);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={qc}>
      {children}
    </TrpcTestProviders>
  );
  const signedOut = renderHook(() => usePusherHandler(undefined), { wrapper });
  await connectPusher();
  expect(signedOut.result.current).toBeUndefined();
  renderHook(() => usePusherHandler("player"), { wrapper }).unmount();
  await connectPusher();
  expect(construct).not.toHaveBeenCalled();
});

/** Exercise live-event guards with an isolated profile cache and mocked transport/playback. */
async function mount(sfxOn = true) {
  let receive!: (data: UserEvent) => Promise<void>;
  vi.spyOn(Pusher, "default").mockImplementation((() => ({
    subscribe: (channel: string) => ({
      bind: (_event: string, handler: typeof receive) => {
        if (channel === "player") receive = handler;
      },
    }),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
    connection: { socket_id: "defender-tab" },
  })) as never);
  vi.spyOn(preferences, "getAudioPreference").mockImplementation(
    (_key, preference) => preference ?? true,
  );
  const play = vi.spyOn(audio, "playPreloadedAudio").mockResolvedValue(undefined);
  play.mockClear();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(qc);
  const key = getQueryKey(testApi.profile.getUser, undefined, "query");
  /** Seed the current account snapshot read by notification guards at delivery time. */
  const setProfile = (sfxOn: boolean, userId = "player") =>
    qc.setQueryData(key, {
      userData: {
        userId,
        sfxOn,
        status: "AWAKE",
        battleId: null,
        rank: "JONIN",
        titles: [],
        items: [],
      },
      notifications: [],
    });
  setProfile(sfxOn);
  const trpcClient = testApi.createClient({ links: [] });
  const wrapper = ({ children }: PropsWithChildren) => (
    <TrpcTestProviders client={trpcClient} queryClient={qc}>
      {children}
    </TrpcTestProviders>
  );
  const view = renderHook(
    ({ villageId }) => usePusherHandler("player", { villageId, clanId: null }),
    {
      wrapper,
      initialProps: { villageId: "village" },
    },
  );
  await connectPusher();
  return {
    qc,
    key,
    play,
    view,
    setProfile,
    receive: (event: Partial<UserEvent> = {}) =>
      receive({ type: "battle", battleId: "battle-one", isDefender: true, ...event }),
  };
}
