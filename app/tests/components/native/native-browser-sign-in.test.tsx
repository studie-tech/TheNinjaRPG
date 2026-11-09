import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as clerk from "@clerk/nextjs";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import NativeBrowserSignIn from "@/components/native/NativeBrowserSignIn";

const approve = vi.fn();
const signOut = vi.fn();
const flowId = "a".repeat(43);
const callbackUrl = `tnr://oauth-callback?flow=${flowId}&code=${"c".repeat(43)}`;

beforeEach(() => {
  approve
    .mockReset()
    .mockResolvedValue({ success: true, message: "Sign-in approved", callbackUrl });
  signOut.mockReset().mockResolvedValue(undefined);
  vi.spyOn(navigation, "useSearchParams").mockReturnValue(
    new URLSearchParams({ flow: flowId }) as never,
  );
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    back: vi.fn(),
    push: vi.fn(),
  } as never);
  vi.spyOn(clerk, "useUser").mockReturnValue({
    isLoaded: true,
    user: { username: "browser-player" },
  } as never);
  vi.spyOn(clerk, "useClerk").mockReturnValue({ signOut } as never);
  Object.assign(vi.spyOn(client, "api" as never), {
    nativeAuth: {
      describe: { useQuery: () => ({ data: { provider: "google" } }) },
      approve: { useMutation: () => ({ mutateAsync: approve, isPending: false }) },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("replaces approval with its callback so a consumed flow cannot be approved again", async () => {
  const view = render(<NativeBrowserSignIn />);
  expect(view.getByRole("button", { name: "Use another account" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Continue to the app" }));
  const link = await view.findByRole("link", { name: "Open the app" });
  expect(link.getAttribute("href")).toBe(callbackUrl);
  expect(view.queryByRole("button", { name: "Continue to the app" })).toBeNull();
  expect(view.queryByRole("button", { name: "Use another account" })).toBeNull();
  expect(approve).toHaveBeenCalledTimes(1);
  expect(approve).toHaveBeenCalledWith({ flowId });
});

it("shows an expired approval and keeps the flow recoverable", async () => {
  const message =
    "Sign-in expired or was already used. Return to the app and try again.";
  approve.mockResolvedValue({ success: false, message });
  const view = render(<NativeBrowserSignIn />);
  fireEvent.click(view.getByRole("button", { name: "Continue to the app" }));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain(message));
  expect(view.queryByRole("link", { name: "Open the app" })).toBeNull();
  expect(view.getByRole("button", { name: "Continue to the app" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Use another account" })).toBeTruthy();
});

it("keeps account recovery available when approval fails", async () => {
  approve.mockRejectedValue(new Error("Flow expired"));
  const view = render(<NativeBrowserSignIn />);
  fireEvent.click(view.getByRole("button", { name: "Continue to the app" }));
  await waitFor(() =>
    expect(view.getByRole("alert").textContent).toContain("Sign-in expired"),
  );
  expect(view.queryByRole("link", { name: "Open the app" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Use another account" }));
  await waitFor(() =>
    expect(signOut).toHaveBeenCalledWith({
      redirectUrl: `/native-sign-in?flow=${flowId}`,
    }),
  );
});
