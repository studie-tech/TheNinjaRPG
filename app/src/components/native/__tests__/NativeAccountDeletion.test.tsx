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
  fetch: vi.fn(),
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
  state.fetch.mockResolvedValue({ json: async () => ({ success: true }) });
  vi.stubGlobal("fetch", state.fetch);
  vi.stubGlobal("React", React);
});
const confirm = () => {
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to permanent deletion" }),
  );
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
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to permanent deletion" }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Verify and permanently delete account",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it("clears confirmations after keeping the account", () => {
    render(<NativeAccountDeletion />);
    confirm();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Keep my account",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to permanent deletion" }),
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect(
      (
        screen.getByRole("button", {
          name: "Verify and permanently delete account",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("cancelling identity verification sends no deletion request", async () => {
    state.cancel = true;
    render(<NativeAccountDeletion />);
    confirm();
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and permanently delete account" }),
    );
    await screen.findByRole("alert");
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.signOut).not.toHaveBeenCalled();
  });
  it("queues once and signs out only after server acceptance", async () => {
    render(<NativeAccountDeletion />);
    confirm();
    const button = screen.getByRole("button", {
      name: "Verify and permanently delete account",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(state.signOut).toHaveBeenCalledOnce());
    expect(state.fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(state.fetch.mock.calls[0]?.[1].body)).toMatchObject({
      expectedUserId: "user_test",
      confirmation: "DELETE MY ACCOUNT",
    });
  });
  it("keeps the user signed in and shows failures", async () => {
    state.fetch.mockResolvedValue({
      json: async () => ({ message: "Service unavailable" }),
    });
    render(<NativeAccountDeletion />);
    confirm();
    fireEvent.click(
      screen.getByRole("button", { name: "Verify and permanently delete account" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Service unavailable",
    );
    expect(state.signOut).not.toHaveBeenCalled();
  });
});
