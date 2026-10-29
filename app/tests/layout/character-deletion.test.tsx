import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as gtm from "@next/third-parties/google";
import * as navigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import { CHARACTER_DELETION_CONFIRMATION } from "@/drizzle/constants";
import DeleteUserButton, { CharacterDeletionSettings } from "@/layout/DeleteUserButton";
import * as Modal from "@/layout/Modal";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";
import { actualModal } from "../setup/preload";

type Result = { success: boolean; message: string };
type Callbacks = { onSuccess: (result: Result) => Promise<void>; onError: (error: { message: string }) => void };
let timerCallbacks: Callbacks;
let deleteCallbacks: Callbacks;
let isPending: boolean;
const toggle = vi.fn();
const remove = vi.fn();
const push = vi.fn();
const invalidate = vi.fn(async () => undefined);
const clearUser = vi.fn();
const userId = "character-owner";
// Radix dispatches DOM events; use the same realm as jsdom and restore Bun's globals.
const browserGlobals = ["Event", "CustomEvent"] as const;
const browserDescriptors = browserGlobals.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));

beforeEach(() => {
  ensureDom();
  for (const key of browserGlobals) Object.defineProperty(globalThis, key, { configurable: true, value: window[key] });
  vi.clearAllMocks();
  isPending = false;
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ profile: { getUser: { invalidate, setData: clearUser }, getPublicUser: { invalidate } } }),
    profile: {
      toggleDeletionTimer: { useMutation: (options: Callbacks) => { timerCallbacks = options; return { mutate: toggle, isPending }; } },
      confirmDeletion: { useMutation: (options: Callbacks) => { deleteCallbacks = options; return { mutate: remove, isPending }; } },
    },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(() => ({ data: { userId }, timeDiff: 0 }) as never);
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push } as never);
  vi.spyOn(Modal, "default").mockImplementation(actualModal);
  vi.spyOn(gtm, "sendGTMEvent").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  browserGlobals.forEach((key, index) => {
    const descriptor = browserDescriptors[index];
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  });
});
const mount = (deletionAt: Date | null = null) => render(<CharacterDeletionSettings userData={{ userId, deletionAt }} />);
const open = (view: ReturnType<typeof mount>, scheduled = false) => {
  fireEvent.click(view.getByRole("button", { name: scheduled ? "Manage deletion request" : "Start deletion timer" }));
  return within(view.getByRole("dialog"));
};
const typeConfirmation = (dialog: ReturnType<typeof open>, phrase = CHARACTER_DELETION_CONFIRMATION) => {
  fireEvent.change(dialog.getByRole("textbox"), { target: { value: phrase } });
};

it("requires the exact phrase to start a timer, including for Enter submission", () => {
  const view = mount();
  const dialog = open(view);
  const proceed = dialog.getByRole("button", { name: "Start deletion timer" }) as HTMLButtonElement;
  expect(proceed.disabled).toBe(true);
  typeConfirmation(dialog, "delete my character");
  fireEvent.keyDown(dialog.getByRole("textbox"), { key: "Enter" });
  expect(toggle).not.toHaveBeenCalled();
  expect(proceed.disabled).toBe(true);
  typeConfirmation(dialog);
  expect(proceed.disabled).toBe(false);
  fireEvent.click(proceed);
  expect(toggle).toHaveBeenCalledWith({ userId, confirmation: CHARACTER_DELETION_CONFIRMATION });
  expect(remove).not.toHaveBeenCalled();
});

it("allows cancellation while the waiting period is active without typing", () => {
  const view = mount(new Date(Date.now() + 60_000));
  const dialog = open(view, true);
  expect(dialog.queryByRole("textbox")).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "Cancel deletion request" }));
  expect(toggle).toHaveBeenCalledWith({ userId });
  expect(remove).not.toHaveBeenCalled();
});

it("requires confirmation again after the wait and offers a separate cancellation", () => {
  const view = mount(new Date(Date.now() - 1000));
  const dialog = open(view, true);
  const proceed = dialog.getByRole("button", { name: "Delete character permanently" }) as HTMLButtonElement;
  expect(proceed.disabled).toBe(true);
  fireEvent.click(dialog.getByRole("button", { name: "Cancel deletion request" }));
  expect(toggle).toHaveBeenCalledWith({ userId });
  expect(remove).not.toHaveBeenCalled();
  typeConfirmation(dialog);
  fireEvent.click(proceed);
  expect(remove).toHaveBeenCalledWith({ userId, confirmation: CHARACTER_DELETION_CONFIRMATION });
});

it("keeps rejected requests open with feedback and clears confirmation when closed", async () => {
  const view = mount();
  let dialog = open(view);
  typeConfirmation(dialog);
  fireEvent.click(dialog.getByRole("button", { name: "Start deletion timer" }));
  await act(async () => timerCallbacks.onSuccess({ success: false, message: "The request could not be saved." }));
  expect(dialog.getByRole("alert").textContent).toBe("The request could not be saved.");
  expect((dialog.getByRole("textbox") as HTMLInputElement).value).toBe(CHARACTER_DELETION_CONFIRMATION);
  fireEvent.click(dialog.getAllByRole("button", { name: "Close" }).find((button) => button.textContent === "Close")!);
  dialog = open(view);
  expect((dialog.getByRole("textbox") as HTMLInputElement).value).toBe("");
});

it("disables controls during requests and clears cached character data after deletion", async () => {
  const deletionAt = new Date(Date.now() - 1000);
  const view = mount(deletionAt);
  const dialog = open(view, true);
  typeConfirmation(dialog);
  fireEvent.click(dialog.getByRole("button", { name: "Delete character permanently" }));
  isPending = true;
  view.rerender(<CharacterDeletionSettings userData={{ userId, deletionAt }} />);
  expect((dialog.getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
  expect((dialog.getByRole("button", { name: "Cancel deletion request" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => deleteCallbacks.onSuccess({ success: true, message: "Deleted" }));
  expect(clearUser).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledTimes(2);
  expect(push).toHaveBeenCalledWith("/");
});

it("preserves staff deletion controls for another character", () => {
  const view = render(<DeleteUserButton userData={{ userId: "another-character", deletionAt: new Date(Date.now() - 1000) }} />);
  fireEvent.click(view.getByRole("button", { name: "Delete character" }));
  const dialog = within(view.getByRole("dialog"));
  expect(dialog.queryByRole("textbox")).toBeNull();
  fireEvent.click(dialog.getByRole("button", { name: "Delete character permanently" }));
  expect(remove).toHaveBeenCalledWith({ userId: "another-character", confirmation: "" });
});
