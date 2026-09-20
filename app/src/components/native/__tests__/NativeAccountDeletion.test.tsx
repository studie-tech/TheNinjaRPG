import * as clerk from "@clerk/nextjs";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "@/app/_trpc/client";
import * as dialog from "@/components/ui/dialog";
import * as input from "@/components/ui/input";
import * as shell from "@/hooks/useNativeShell";
import * as contentBox from "@/layout/ContentBox";
import { appleAuth } from "@/libs/native";
import { ensureDom } from "../../../../tests/setup-dom.mjs";
import { NativeAccountDeletion } from "../NativeAccountDeletion";

let screen: ReturnType<typeof within>;
const state = { native: true, mutate: vi.fn(), signOut: vi.fn(), cancel: false };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  state.native = true;
  state.cancel = false;
  state.signOut.mockResolvedValue(undefined);
  state.mutate.mockResolvedValue({ success: true });
  ensureDom();
  screen = within(document.body);
  vi.spyOn(clerk, "useUser").mockReturnValue({
    isLoaded: true,
    user: {
      id: "user_test",
      primaryEmailAddress: { emailAddress: "test@example.com" },
      externalAccounts: [],
    },
  } as unknown as ReturnType<typeof clerk.useUser>);
  vi.spyOn(clerk, "useClerk").mockReturnValue({
    signOut: state.signOut,
  } as unknown as ReturnType<typeof clerk.useClerk>);
  vi.spyOn(clerk, "useReverification").mockImplementation(
    ((fn: (body: unknown) => Promise<unknown>) => (body: unknown) =>
      state.cancel
        ? Promise.reject(new Error("Verification cancelled"))
        : fn(body)) as typeof clerk.useReverification,
  );
  Object.assign(vi.spyOn(client, "api" as never), {
    accountDeletion: {
      request: { useMutation: () => ({ mutateAsync: state.mutate }) },
    },
  });
  vi.spyOn(shell, "useNativeShell").mockImplementation(() => state.native);
  vi.spyOn(contentBox, "default").mockImplementation(({ children }) =>
    React.createElement("div", null, children),
  );
  // The server preload initializes React's legacy change-event fallback before DOM.
  // Keep this suite focused on confirmation/recovery, using a native input event.
  vi.spyOn(input, "Input").mockImplementation(({ onChange, ...props }) => (
    <input
      {...props}
      onInput={(event) =>
        onChange?.(event as unknown as React.ChangeEvent<HTMLInputElement>)
      }
    />
  ));
  vi.spyOn(dialog, "Dialog").mockImplementation(({ open, children }) =>
    open ? <>{children}</> : null,
  );
  vi.spyOn(dialog, "DialogContent").mockImplementation(({ children }) => (
    <div role="dialog">{children}</div>
  ));
  vi.spyOn(dialog, "DialogHeader").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(dialog, "DialogFooter").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(dialog, "DialogTitle").mockImplementation(({ children }) => (
    <h2>{children}</h2>
  ));
  vi.spyOn(dialog, "DialogDescription").mockImplementation(({ children }) => (
    <p>{children}</p>
  ));
  vi.spyOn(appleAuth, "isSupported").mockReturnValue(false);
});
const confirm = () => {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(
    screen.getByLabelText(
      "I understand that my account and progress cannot be recovered.",
    ),
  );
  fireEvent.click(
    screen.getByLabelText(
      "I understand that recurring subscriptions must be cancelled separately.",
    ),
  );
  fireEvent.input(screen.getByRole("textbox"), {
    target: { value: "DELETE MY ACCOUNT" },
  });
};

describe("native deletion confirmation", () => {
  it("renders no deletion controls on the web", () => {
    state.native = false;
    const { container } = render(<NativeAccountDeletion />);
    expect(container.firstChild).toBeNull();
  });
  it("requires both acknowledgements and the exact phrase", () => {
    render(<NativeAccountDeletion />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      (
        screen.getByRole("button", {
          name: "Delete permanently",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it("clears confirmations after keeping the account", () => {
    render(<NativeAccountDeletion />);
    confirm();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Keep my account",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect(
      (
        screen.getByRole("button", {
          name: "Delete permanently",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("cancelling identity verification sends no deletion request", async () => {
    state.cancel = true;
    render(<NativeAccountDeletion />);
    confirm();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await screen.findByRole("alert");
    expect(state.mutate).not.toHaveBeenCalled();
    expect(state.signOut).not.toHaveBeenCalled();
  });
  it("queues once and signs out only after server acceptance", async () => {
    render(<NativeAccountDeletion />);
    confirm();
    const button = screen.getByRole("button", {
      name: "Delete permanently",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(state.signOut).toHaveBeenCalledOnce());
    expect(state.mutate).toHaveBeenCalledOnce();
    expect(state.mutate.mock.calls[0]?.[0]).toMatchObject({
      expectedUserId: "user_test",
      confirmation: "DELETE MY ACCOUNT",
    });
  });
  it.each([
    "Use the native app to request account deletion.",
    "Your signed-in account changed. Close this dialog and start again.",
    "Service unavailable",
  ])("keeps the dialog usable after rejection: %s", async (message) => {
    state.mutate.mockResolvedValue({
      success: false,
      message,
    });
    render(<NativeAccountDeletion />);
    confirm();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect((await screen.findByRole("alert")).textContent).toContain(message);
    expect(state.signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Keep my account",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    state.mutate.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    await waitFor(() => expect(state.signOut).toHaveBeenCalledOnce());
    expect(state.mutate).toHaveBeenCalledTimes(2);
  });
});
