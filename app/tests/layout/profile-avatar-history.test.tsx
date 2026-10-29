import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import * as Avatar from "@/layout/Avatar";
import * as Modal from "@/layout/Modal";
import { HistoricalAiAvatar } from "@/layout/ProfileEdit";
import * as pagination from "@/libs/pagination";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

let avatars: { id: string; avatar: string }[];
let isPending: boolean;
let isError: boolean;
const select = vi.fn();
const remove = vi.fn();
const refetch = vi.fn();

beforeEach(() => {
  ensureDom();
  avatars = [];
  isPending = false;
  isError = false;
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({}),
    avatar: {
      getHistoricalAvatars: { useInfiniteQuery: () => ({ data: { pages: [{ data: avatars }] }, fetchNextPage: vi.fn(), hasNextPage: false, isPending, isError, refetch }) },
      updateAvatar: { useMutation: () => ({ mutate: select, isPending: false }) },
      deleteAvatar: { useMutation: () => ({ mutate: remove, isPending: false }) },
    },
  });
  vi.spyOn(UserContext, "useRequiredUserData").mockImplementation(() => ({ data: { username: "Player" }, updateUser: vi.fn() }) as never);
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(Avatar, "default").mockImplementation(({ alt }) => <img alt={alt} />);
  vi.spyOn(Modal, "default").mockImplementation(({ isOpen, title, children, onAccept }) => isOpen ? (
    <div role="dialog" aria-label={title}>{children}<button type="button" onClick={onAccept}>Proceed</button></div>
  ) : null);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("explains an empty avatar collection", () => {
  const view = render(<HistoricalAiAvatar contentType="user" />);
  expect(view.getByText(/No previous avatars yet/)).toBeTruthy();
});

it("shows loading feedback and lets a failed collection retry", () => {
  isPending = true;
  const view = render(<HistoricalAiAvatar contentType="user" />);
  expect(view.getByText("Loading previous avatars")).toBeTruthy();
  isPending = false;
  isError = true;
  view.rerender(<HistoricalAiAvatar contentType="user" />);
  expect(view.getByRole("alert").textContent).toContain("Could not load");
  fireEvent.click(view.getByRole("button", { name: "Try again" }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it("keeps avatar selection separate from confirmed deletion", () => {
  avatars = [{ id: "saved-avatar", avatar: "/saved.webp" }];
  const view = render(<HistoricalAiAvatar contentType="user" />);
  const choose = view.getByRole("button", { name: "Use saved avatar 1" });
  expect(choose.querySelector('button, [role="button"]')).toBeNull();
  fireEvent.click(choose);
  expect(select).toHaveBeenCalledWith({ avatar: "saved-avatar", type: "user" });
  const deleteButton = view.getAllByRole("button", { name: "Delete saved avatar 1" }).find((button) => button.tagName === "BUTTON")!;
  fireEvent.click(deleteButton);
  expect(select).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(within(view.getByRole("dialog", { name: "Confirm Deletion" })).getByRole("button", { name: "Proceed" }));
  expect(remove).toHaveBeenCalledWith({ avatar: "saved-avatar" });
});

it("disables selection and deletion while the owning editor is unavailable", () => {
  avatars = [{ id: "saved-avatar", avatar: "/saved.webp" }];
  const view = render(<HistoricalAiAvatar contentType="user" disabled />);
  expect((view.getByRole("button", { name: "Use saved avatar 1" }) as HTMLButtonElement).disabled).toBe(true);
  expect((view.getAllByRole("button", { name: "Delete saved avatar 1" }).find((button) => button.tagName === "BUTTON") as HTMLButtonElement).disabled).toBe(true);
});
