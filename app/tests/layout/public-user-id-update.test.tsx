import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import type { ComponentProps } from "react";
import * as nextNavigation from "next/navigation";
import * as client from "@/app/_trpc/client";
import * as Modal from "@/layout/Modal";
import { UpdateUserIdButton } from "@/layout/publicUser/UpdateUserIdButton";
import * as toast from "@/libs/toast";

const replace = vi.fn();
const invalidate = vi.fn(async () => undefined);
const mutateAsync = vi.fn(async () => ({ success: true, message: "Moved" }));

beforeEach(() => {
  replace.mockClear();
  mutateAsync.mockClear();
  vi.spyOn(nextNavigation, "useRouter").mockImplementation(
    () => ({ replace }) as never,
  );
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({
      profile: { getPublicUser: { invalidate }, getPublicUsers: { invalidate } },
    }),
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(Modal, "default").mockImplementation(
    ({ isOpen, title, children, onAccept }) =>
      isOpen ? (
        <div role="dialog" aria-label={title}>
          {children}
          <button type="button" onClick={(event) => onAccept?.(event as never)}>
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

type Mutation = ComponentProps<typeof UpdateUserIdButton>["updateUserIdMutation"];

it("removes the stale action once the identity move commits", async () => {
  const view = render(
    <UpdateUserIdButton
      userId="old_id"
      username="Mover"
      updateUserIdMutation={{ mutateAsync } as unknown as Mutation}
    />,
  );
  fireEvent.click(view.getAllByRole("button")[0] as HTMLElement);
  const input = view.getByLabelText("New Clerk user ID");
  fireEvent.change(input, { target: { value: "new_id" } });
  fireEvent.click(view.getByRole("button", { name: "Proceed" }));
  await waitFor(() =>
    expect(mutateAsync).toHaveBeenCalledWith({ userId: "old_id", newUserId: "new_id" }),
  );
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/userid/new_id"));
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.container.innerHTML).toBe("");
});

it("keeps the confirmation open after a rejected move", async () => {
  mutateAsync.mockResolvedValueOnce({ success: false, message: "Taken" });
  const view = render(
    <UpdateUserIdButton
      userId="old_id"
      username="Mover"
      updateUserIdMutation={{ mutateAsync } as unknown as Mutation}
    />,
  );
  fireEvent.click(view.getAllByRole("button")[0] as HTMLElement);
  fireEvent.change(view.getByLabelText("New Clerk user ID"), {
    target: { value: "new_id" },
  });
  fireEvent.click(view.getByRole("button", { name: "Proceed" }));
  await waitFor(() =>
    expect(toast.showMutationToast).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    ),
  );
  expect(view.getByRole("dialog", { name: "Update User ID" })).toBeTruthy();
  expect(replace).not.toHaveBeenCalled();
});
