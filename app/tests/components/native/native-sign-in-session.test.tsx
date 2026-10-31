import * as clerk from "@clerk/nextjs";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import NativeSignIn from "@/components/native/NativeSignIn";
import * as handoff from "@/hooks/useNativeAuthHandoff";
import * as shell from "@/hooks/useNativeShell";
import { ActiveSessionBoundary } from "@/layout/ActiveSessionBoundary";
import * as native from "@/libs/native";
import { appleAuth } from "@/libs/native";
import { ensureDom } from "../../setup/dom.mjs";

ensureDom();
const replace = vi.fn();
const create = vi.fn();
const setActive = vi.fn();
let session: { id: string } | null;
let loaded: boolean;
let isShell: boolean;

beforeEach(() => {
  session = null;
  loaded = true;
  isShell = true;
  vi.clearAllMocks();
  vi.spyOn(navigation, "useRouter").mockReturnValue({ replace } as never);
  vi.spyOn(shell, "useNativeShell").mockImplementation(() => isShell);
  vi.spyOn(native, "isNative").mockReturnValue(true);
  vi.spyOn(appleAuth, "isSupported").mockReturnValue(true);
  vi.spyOn(appleAuth, "authorize").mockResolvedValue({ identityToken: "native-token", user: "apple-user" });
  vi.spyOn(handoff, "useNativeAuthHandoff").mockReturnValue({ start: vi.fn(), exchange: vi.fn() });
  vi.spyOn(clerk, "useSession").mockImplementation(() => ({
    isLoaded: loaded, isSignedIn: loaded && !!session, session,
  }) as ReturnType<typeof clerk.useSession>);
  vi.spyOn(clerk, "useClerk").mockReturnValue({
    client: { signIn: { create } }, get session() { return session; }, setActive,
  } as unknown as ReturnType<typeof clerk.useClerk>);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("returns an activated native session home even when the account boundary retires the sign-in callback", async () => {
  let finish: (result: { createdSessionId: string }) => void = () => {};
  create.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const tree = () => <ActiveSessionBoundary><NativeSignIn /></ActiveSessionBoundary>;
  const view = render(tree());
  fireEvent.click(view.getByRole("button", { name: /Continue with Apple$/ }));
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  // Clerk publishes the active account before its sign-in promise settles. The
  // boundary must still retire all state belonging to the anonymous session.
  session = { id: "apple-session" };
  view.rerender(tree());
  await act(async () => finish({ createdSessionId: "apple-session" }));
  expect(setActive).not.toHaveBeenCalled();
  expect(replace).toHaveBeenCalledWith("/");
});

it("does not leave login for a loading, signed-out or ordinary browser session", () => {
  const view = render(<NativeSignIn />);
  expect(replace).not.toHaveBeenCalled();
  session = { id: "existing-session" }; loaded = false;
  view.rerender(<NativeSignIn />);
  expect(replace).not.toHaveBeenCalled();
  loaded = true; isShell = false;
  view.rerender(<NativeSignIn />);
  expect(replace).not.toHaveBeenCalled();
});
