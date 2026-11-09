import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as Modal from "@/layout/Modal";
import { NameChange } from "@/layout/profileEdit/NameChange";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";

let resolveUpdate: (value: { success: boolean; message: string }) => void;
const updateUsername = vi.fn(
  () =>
    new Promise<{ success: boolean; message: string }>((resolve) => {
      resolveUpdate = resolve;
    }),
);

beforeEach(() => {
  updateUsername.mockClear();
  Object.assign(vi.spyOn(client, "api" as never), {
    profile: {
      getUsername: { useQuery: () => ({ data: undefined }) },
      updateUsername: { useMutation: () => ({ mutateAsync: updateUsername }) },
    },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(
    () =>
      ({
        data: { reputationPoints: 1000 },
        updateUser: vi.fn(),
        prepareUserUpdate: vi.fn(),
      }) as never,
  );
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(Modal, "default").mockImplementation(
    ({ isOpen, title, children, onAccept, isLoading }) =>
      isOpen ? (
        <div role="dialog" aria-label={title}>
          {children}
          <button
            type="button"
            disabled={isLoading}
            onClick={(event) => onAccept?.(event as never)}
          >
            Proceed
          </button>
        </div>
      ) : null,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const typeAndConfirm = async (username: string) => {
  const view = render(<NameChange />);
  const input = view.getByPlaceholderText("Search user") as HTMLInputElement;
  const submit = view.getByRole("button", {
    name: "Update Username",
  }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.change(input, { target: { value: username } });
  expect(input.value).toBe(username);
  await waitFor(() => expect(submit.disabled).toBe(false));
  fireEvent.click(submit);
  const dialog = view.getByRole("dialog", { name: "Confirm New Username" });
  expect(dialog.textContent).toContain(`change your username to ${username}?`);
  return { view, input };
};

it("submits the typed name and keeps it editable after a rejection", async () => {
  const { view, input } = await typeAndConfirm("NewName");
  fireEvent.click(view.getByRole("button", { name: "Proceed" }));
  expect(updateUsername).toHaveBeenCalledWith({ username: "NewName" });
  await waitFor(() => expect(input.readOnly).toBe(true));
  resolveUpdate({ success: false, message: "Taken" });
  await waitFor(() => expect(input.readOnly).toBe(false));
  expect(input.value).toBe("NewName");
  expect(
    view.getByRole("dialog", { name: "Confirm New Username" }).textContent,
  ).toContain("change your username to NewName?");
  fireEvent.change(input, { target: { value: "OtherName" } });
  expect(input.value).toBe("OtherName");
});

it("closes the confirmation once the paid change commits", async () => {
  const { view } = await typeAndConfirm("NewName");
  fireEvent.click(view.getByRole("button", { name: "Proceed" }));
  resolveUpdate({ success: true, message: "Changed" });
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
});

it("does not open the confirmation for an empty name", () => {
  const view = render(<NameChange />);
  fireEvent.submit(
    view
      .getByRole("button", { name: "Update Username" })
      .closest("form") as HTMLFormElement,
  );
  expect(view.queryByRole("dialog")).toBeNull();
});
