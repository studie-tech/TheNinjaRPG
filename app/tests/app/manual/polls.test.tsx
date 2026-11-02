import * as useSize from "@radix-ui/react-use-size";
import { QueryClient, QueryClientProvider, useMutation, type UseMutationOptions } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { Controller } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import PollsPage from "@/app/[shell]/manual/polls/page";
import * as dialog from "@/components/ui/dialog";
import * as ContentBox from "@/layout/ContentBox";
import * as RichInput from "@/layout/RichInput";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import * as pagination from "@/libs/pagination";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import { ensureDom } from "../../setup/dom.mjs";
import { actualDialog } from "../../setup/preload";

type Result = RouterOutputs["poll"]["createPoll"];
type CreateInput = RouterInputs["poll"]["createPoll"];
type UpdateInput = RouterInputs["poll"]["updatePoll"];

const poll: RouterOutputs["poll"]["getPolls"]["data"][number] = {
  id: "poll-1", title: "Original title", description: "Original description",
  createdByUserId: "admin", createdBy: { userId: "admin", username: "Admin", avatar: null },
  createdAt: new Date(), updatedAt: new Date(), endDate: null,
  isActive: true, allowCustomOptions: true, options: [], totalVotes: 0,
};

let queryClient: QueryClient;
let resolveSave: (result: Result) => void;
let resolveRefresh: () => void;
const create = vi.fn((_input: CreateInput) => new Promise<Result>((resolve) => { resolveSave = resolve; }));
const update = vi.fn((_input: UpdateInput) => new Promise<Result>((resolve) => { resolveSave = resolve; }));
const invalidate = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve; }));
const noMutation = () => ({ mutate: vi.fn(), isPending: false });
const originalEvent = globalThis.Event;
const originalCustomEvent = globalThis.CustomEvent;

beforeEach(() => {
  ensureDom();
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  vi.clearAllMocks();
  vi.spyOn(useSize, "useSize").mockReturnValue({ width: 0, height: 0 });
  queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ poll: { getPolls: { invalidate } } }),
    poll: {
      getPolls: { useInfiniteQuery: () => ({ data: { pages: [{ data: [poll], nextCursor: null }] }, isLoading: false, fetchNextPage: async () => undefined, hasNextPage: false }) },
      getUserVote: { useQuery: () => ({ data: null }) },
      createPoll: { useMutation: (options: UseMutationOptions<Result, Error, CreateInput>) => useMutation({ ...options, mutationFn: create }) },
      updatePoll: { useMutation: (options: UseMutationOptions<Result, Error, UpdateInput>) => useMutation({ ...options, mutationFn: update }) },
      vote: { useMutation: noMutation }, retractVote: { useMutation: noMutation },
      addOption: { useMutation: noMutation }, closePoll: { useMutation: noMutation },
      deletePollOption: { useMutation: noMutation },
    },
  });
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { userId: "admin", role: "CONTENT-ADMIN" } } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(RichInput, "default").mockImplementation(({ control, id }) => (
    <Controller control={control} name={id} render={({ field }) => <textarea aria-label="Description" {...field} />} />
  ));
  vi.spyOn(UserSearchSelect, "default").mockImplementation(() => null);
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  for (const key of ["Dialog", "DialogContent", "DialogFooter", "DialogHeader", "DialogTitle", "DialogDescription"] as const) {
    vi.spyOn(dialog, key).mockImplementation(actualDialog[key] as never);
  }
});

afterEach(async () => {
  cleanup();
  // Radix restores focus asynchronously when its dialog unmounts.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  queryClient.clear();
  vi.restoreAllMocks();
  globalThis.Event = originalEvent;
  globalThis.CustomEvent = originalCustomEvent;
});

it("preserves a rejected create draft for retry and leaves the editor after a committed save", async () => {
  const view = render(<QueryClientProvider client={queryClient}><PollsPage /></QueryClientProvider>);
  fireEvent.mouseDown(view.getByRole("tab", { name: "Create Poll" }), { button: 0, ctrlKey: false });
  fireEvent.change(view.getByLabelText("Poll Title"), { target: { value: "Authored title" } });
  fireEvent.change(view.getByLabelText("Description"), { target: { value: "Authored description" } });
  fireEvent.change(view.getByPlaceholderText("Option 1"), { target: { value: "First option" } });
  fireEvent.change(view.getByPlaceholderText("Option 2"), { target: { value: "Second option" } });
  const submit = view.getByRole("button", { name: "Create Poll" }) as HTMLButtonElement;
  fireEvent.click(submit);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(submit.disabled).toBe(true));

  const rejection = { success: false, message: "You don't have permission to create polls" };
  await act(async () => { resolveSave(rejection); });
  await waitFor(() => expect(submit.disabled).toBe(false));
  expect(toast.showMutationToast).toHaveBeenCalledWith(rejection);
  expect(view.getByRole("alert").textContent).toBe(rejection.message);
  expect(invalidate).not.toHaveBeenCalled();
  expect((view.getByLabelText("Poll Title") as HTMLInputElement).value).toBe("Authored title");
  expect((view.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Authored description");
  expect((view.getByPlaceholderText("Option 1") as HTMLInputElement).value).toBe("First option");
  expect((view.getByPlaceholderText("Option 2") as HTMLInputElement).value).toBe("Second option");

  fireEvent.click(submit);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(create.mock.calls[1]?.[0]).toEqual(create.mock.calls[0]?.[0]);
  await act(async () => { resolveSave({ success: true, message: "Poll created successfully" }); });
  // A slow refresh must not leave a committed save open for resubmission.
  await waitFor(() => expect(view.getByRole("tab", { name: "Active Polls" }).getAttribute("aria-selected")).toBe("true"));
  expect(invalidate).toHaveBeenCalledTimes(1);
  await act(async () => { resolveRefresh(); });
});

it("keeps a rejected edit open with its draft, then closes it after a successful retry", async () => {
  const view = render(<QueryClientProvider client={queryClient}><PollsPage /></QueryClientProvider>);
  fireEvent.click(view.getByRole("button", { name: "Edit poll" }));
  fireEvent.change(view.getByLabelText("Title"), { target: { value: "Revised title" } });
  fireEvent.change(view.getByLabelText("Description"), { target: { value: "Revised description" } });
  fireEvent.click(view.getByRole("button", { name: "Update Poll" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  await waitFor(() => expect((view.getByRole("button", { name: "Updating..." }) as HTMLButtonElement).disabled).toBe(true));

  const rejection = { success: false, message: "Poll not found" };
  await act(async () => { resolveSave(rejection); });
  await waitFor(() => expect((view.getByRole("button", { name: "Update Poll" }) as HTMLButtonElement).disabled).toBe(false));
  expect(toast.showMutationToast).toHaveBeenCalledWith(rejection);
  expect(view.getByRole("alert").textContent).toBe(rejection.message);
  expect(invalidate).not.toHaveBeenCalled();
  expect(view.getByRole("dialog")).toBeDefined();
  expect((view.getByLabelText("Title") as HTMLInputElement).value).toBe("Revised title");
  expect((view.getByLabelText("Description") as HTMLTextAreaElement).value).toBe("Revised description");

  fireEvent.click(view.getByRole("button", { name: "Update Poll" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update.mock.calls[1]?.[0]).toEqual(update.mock.calls[0]?.[0]);
  await act(async () => { resolveSave({ success: true, message: "Poll updated successfully" }); });
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(invalidate).toHaveBeenCalledTimes(1);
  await act(async () => { resolveRefresh(); });
});
