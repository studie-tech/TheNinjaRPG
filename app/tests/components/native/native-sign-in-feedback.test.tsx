import * as clerk from "@clerk/nextjs";
import * as navigation from "next/navigation";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import NativeSignIn from "@/components/native/NativeSignIn";
import * as auth from "@/hooks/useNativeAuth";
import * as shell from "@/hooks/useNativeShell";
import { appleAuth } from "@/libs/native";
import { ensureDom } from "../../setup/dom.mjs";

const signIn = vi.fn<() => Promise<auth.NativeAuthResult>>();

beforeEach(() => {
  ensureDom();
  signIn.mockReset();
  vi.spyOn(clerk, "useSession").mockReturnValue({ isLoaded: true, isSignedIn: false } as ReturnType<typeof clerk.useSession>);
  vi.spyOn(navigation, "useRouter").mockReturnValue({ replace: vi.fn() } as never);
  vi.spyOn(shell, "useNativeShell").mockReturnValue(true);
  vi.spyOn(appleAuth, "isSupported").mockReturnValue(true);
  vi.spyOn(auth, "useNativeAuth").mockReturnValue({
    isReady: true,
    isPending: false,
    signInWithApple: signIn,
    signInWithProvider: signIn,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("native sign-in feedback", () => {
  it("keeps the failure next to usable sign-in controls until another attempt", async () => {
    signIn.mockResolvedValue({ status: "error", message: "Unable to verify your Apple account." });
    const view = render(<NativeSignIn />);
    fireEvent.click(view.getByRole("button", { name: /Continue with Apple$/ }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("Unable to verify your Apple account."));
    view.rerender(<NativeSignIn />);
    expect(view.getByRole("alert").textContent).toBe("Unable to verify your Apple account.");
    expect((view.getByRole("button", { name: /Continue with Apple$/ }) as HTMLButtonElement).disabled).toBe(false);

    let finish: ((result: auth.NativeAuthResult) => void) | undefined;
    signIn.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    fireEvent.click(view.getByRole("button", { name: /Continue with Apple$/ }));
    expect(view.queryByRole("alert")).toBeNull();
    await act(async () => { finish?.({ status: "cancelled" }); });
    expect(view.queryByRole("alert")).toBeNull();
  });

  it("retains provider errors and clears them when switching to a cancelled provider", async () => {
    signIn.mockResolvedValueOnce({ status: "error", message: "Google sign-in could not complete." });
    const view = render(<NativeSignIn />);
    fireEvent.click(view.getByRole("button", { name: /Continue with Google$/ }));
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("Google sign-in could not complete."));
    signIn.mockResolvedValueOnce({ status: "cancelled" });
    fireEvent.click(view.getByRole("button", { name: /Continue with Discord$/ }));
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(2));
    expect(view.queryByRole("alert")).toBeNull();
  });
});
