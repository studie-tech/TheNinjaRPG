import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { createStore, Provider } from "jotai";
import * as clerk from "@clerk/nextjs";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import NativeBridge from "@/components/native/NativeBridge";
import * as activity from "@/hooks/useLiveActivity";
import * as push from "@/hooks/useNativePush";
import HomeLanding from "@/layout/HomeLanding";
import * as Loader from "@/layout/Loader";
import * as Welcome from "@/layout/Welcome";
import * as native from "@/libs/native";
import * as UserContext from "@/utils/UserContext";
import * as routing from "@/utils/routing";
import { ensureDom } from "../setup/dom.mjs";

const navigate = vi.fn();
let onUrl: (url: string) => void;
let pathname: string;
let session: ReturnType<typeof UserContext.useUserData>;
const character = { userId: "player", status: "AWAKE", userQuests: [] } as unknown as NonNullable<typeof session.data>;

beforeEach(() => {
  ensureDom();
  navigate.mockClear();
  pathname = "/";
  session = { isClerkLoaded: false, isSignedIn: true, userId: "player", data: undefined, status: "pending" } as typeof session;
  vi.spyOn(UserContext, "useUserData").mockImplementation(() => session);
  vi.spyOn(clerk, "useClerk").mockReturnValue({ signOut: vi.fn() } as never);
  vi.spyOn(routing, "usePublicPathname").mockImplementation(() => pathname);
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: navigate, back: vi.fn() } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    register: { setReferralSource: { useMutation: () => ({ mutate: vi.fn() }) } },
    useUtils: () => ({ profile: { getUser: { invalidate: vi.fn(async () => {}) } } }),
  });
  vi.spyOn(Welcome, "default").mockImplementation(() => <p>Public welcome</p>);
  vi.spyOn(Loader, "default").mockImplementation(({ explanation }) => <p>{explanation}</p>);
  vi.spyOn(activity, "useLiveActivity").mockImplementation(() => {});
  vi.spyOn(push, "useNativePush").mockReturnValue({ unregister: vi.fn(async () => {}) } as never);
  vi.spyOn(native, "isNative").mockReturnValue(true);
  vi.spyOn(native, "platform").mockReturnValue("ios");
  vi.spyOn(native.appEvents, "onUrlOpen").mockImplementation((callback) => { onUrl = callback; return () => {}; });
  vi.spyOn(native.appEvents, "onBackButton").mockReturnValue(() => {});
  vi.spyOn(native.appEvents, "onStateChange").mockReturnValue(() => {});
  vi.spyOn(native.widgets, "sync").mockResolvedValue(undefined);
  vi.spyOn(native.widgets, "clear").mockResolvedValue(undefined);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = () => {
  const store = createStore();
  const tree = (home = true) => <Provider store={store}><NativeBridge />{home && <HomeLanding />}</Provider>;
  const view = render(tree());
  return { ...view, update: (home = true) => view.rerender(tree(home)) };
};

describe("native links during home startup", () => {
  it("keeps the OS destination when the character finishes loading after the link", () => {
    const view = mount();
    act(() => onUrl("https://www.theninja-rpg.com/jutsus?tab=loadout#equipped"));
    expect(navigate).toHaveBeenLastCalledWith("/jutsus?tab=loadout#equipped");
    session = { ...session, isClerkLoaded: true, data: character, status: "success" };
    view.update();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenLastCalledWith("/jutsus?tab=loadout#equipped");
    const navigationCount = navigate.mock.calls.length;
    session = { ...session, data: { ...character } };
    view.update();
    expect(navigate).toHaveBeenLastCalledWith("/jutsus?tab=loadout#equipped");
    expect(navigate).toHaveBeenCalledTimes(navigationCount);
  });

  it("lets a newer Home link supersede a pending non-Home destination", () => {
    const view = mount();
    act(() => onUrl("https://www.theninja-rpg.com/jutsus"));
    act(() => onUrl("https://www.theninja-rpg.com/?ref=newer"));
    session = { ...session, isClerkLoaded: true, data: character, status: "success" };
    view.update();
    expect(navigate.mock.calls.map(([path]) => path)).toEqual([
      "/jutsus", "/?ref=newer", "/profile",
    ]);
  });

  it("reconsiders Home when the newer Home link arrives after character loading", () => {
    const view = mount();
    act(() => onUrl("https://www.theninja-rpg.com/jutsus"));
    session = { ...session, isClerkLoaded: true, data: character, status: "success" };
    view.update();
    expect(navigate).toHaveBeenCalledTimes(1);
    act(() => onUrl("https://www.theninja-rpg.com/"));
    expect(navigate).toHaveBeenLastCalledWith("/profile");
  });

  it("keeps a newer native destination without duplicating either issued push", () => {
    const view = mount();
    act(() => onUrl("https://www.theninja-rpg.com/jutsus"));
    act(() => onUrl("https://www.theninja-rpg.com/settings/device"));
    session = { ...session, isClerkLoaded: true, data: character, status: "success" };
    view.update();
    expect(navigate.mock.calls.map(([path]) => path)).toEqual([
      "/jutsus", "/settings/device",
    ]);
  });

  it("does not replay the startup link when Home is opened later", () => {
    const view = mount();
    act(() => onUrl("https://www.theninja-rpg.com/jutsus"));
    session = { ...session, isClerkLoaded: true, data: character, status: "success" };
    pathname = "/jutsus";
    view.update(false);
    navigate.mockClear();
    pathname = "/";
    view.update();
    expect(navigate).toHaveBeenLastCalledWith("/profile");
  });

  it.each(["https://example.com/jutsus", "https://www.theninja-rpg.com/native-sign-in?flow=browser", "https://www.theninja-rpg.com/?ref=campaign"])("preserves normal home forwarding for %s", (url) => {
    const view = mount();
    act(() => onUrl(url));
    session = { ...session, isClerkLoaded: true, data: character, status: "success" };
    view.update();
    expect(navigate).toHaveBeenLastCalledWith("/profile");
  });
});
