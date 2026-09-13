import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  native: true,
  mutate: vi.fn(),
  signOut: vi.fn(),
  cancel: false,
}));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isLoaded: true,
    user: {
      id: "user_test",
      primaryEmailAddress: { emailAddress: "test@example.com" },
      externalAccounts: [],
    },
  }),
  useClerk: () => ({ signOut: state.signOut }),
  useReverification: (fn: (body: string) => Promise<unknown>) => (body: string) =>
    state.cancel ? Promise.reject(new Error("Verification cancelled")) : fn(body),
}));
vi.mock("@/app/_trpc/client", () => ({
  api: {
    accountDeletion: {
      request: { useMutation: () => ({ mutateAsync: state.mutate }) },
    },
  },
}));
vi.mock("@/hooks/useNativeShell", () => ({ useNativeShell: () => state.native }));
vi.mock("@/layout/ContentBox", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", null, children),
}));
vi.mock("@/libs/native", () => ({ appleAuth: { isSupported: () => false } }));

import { NativeAccountDeletion } from "../NativeAccountDeletion";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.clearAllMocks();
  state.native = true;
  state.cancel = false;
  state.signOut.mockResolvedValue(undefined);
  state.mutate.mockResolvedValue({ success: true });
  vi.stubGlobal("React", React);
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
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "DELETE MY ACCOUNT" },
  });
};

describe("native deletion confirmation", () => {
  it("renders no deletion controls on the web", () => {
    state.native = false;
    render(<NativeAccountDeletion />);
    expect(screen.queryByRole("button")).toBeNull();
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
  it("keeps the user signed in and shows failures", async () => {
    state.mutate.mockResolvedValue({
      success: false,
      message: "Service unavailable",
    });
    render(<NativeAccountDeletion />);
    confirm();
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Service unavailable",
    );
    expect(state.signOut).not.toHaveBeenCalled();
  });
});
