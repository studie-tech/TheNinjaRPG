import * as useSize from "@radix-ui/react-use-size";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ComponentProps } from "react";
import { format } from "date-fns";
import { Controller } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import type { RouterInputs, RouterOutputs } from "@/app/_trpc/client";
import PollsPage from "@/app/[shell]/manual/polls/page";
import * as tabs from "@/components/ui/tabs";
import * as Avatar from "@/layout/Avatar";
import * as ContentBox from "@/layout/ContentBox";
import * as RichInput from "@/layout/RichInput";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import * as pagination from "@/libs/pagination";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import type { CreatePollSchema } from "@/validators/poll";
import {
  flushRadixFocus,
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

type Result = RouterOutputs["poll"]["createPoll"];
type CreateInput = RouterInputs["poll"]["createPoll"];
type UpdateInput = RouterInputs["poll"]["updatePoll"];

const poll: RouterOutputs["poll"]["getPolls"]["data"][number] = {
  id: "poll-1",
  title: "Original title",
  description: "Original description",
  createdByUserId: "admin",
  createdBy: { userId: "admin", username: "Admin", avatar: null },
  createdAt: new Date(),
  updatedAt: new Date(),
  endDate: null,
  isActive: true,
  allowCustomOptions: true,
  options: [],
  totalVotes: 0,
};

let queryClient: QueryClient;
let resolveSave: (result: Result) => void;
let resolveRefresh: () => void;
const create = vi.fn(
  (_input: CreateInput) =>
    new Promise<Result>((resolve) => {
      resolveSave = resolve;
    }),
);
const update = vi.fn(
  (_input: UpdateInput) =>
    new Promise<Result>((resolve) => {
      resolveSave = resolve;
    }),
);
const invalidate = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    }),
);
const noMutation = () => ({ mutate: vi.fn(), isPending: false });
type Response = { success: boolean; message: string };
let onSuccess: (response: Response) => void;
const createPollForm = vi.fn((_input: CreatePollSchema) => undefined);
const invalidateForm = vi.fn(async () => undefined);
const players = [
  {
    userId: "user-1",
    username: "Player One",
    avatar: null,
    level: 10,
    rank: "GENIN",
    federalStatus: "NONE",
  },
  {
    userId: "user-2",
    username: "Player Two",
    avatar: null,
    level: 10,
    rank: "GENIN",
    federalStatus: "NONE",
  },
];
const createPollUsers = vi.fn<(data: CreatePollSchema) => void>();

beforeEach(() => {
  installBrowserGlobals();
  vi.clearAllMocks();
  vi.spyOn(useSize, "useSize").mockReturnValue({ width: 0, height: 0 });
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(RichInput, "default").mockImplementation(({ control, id }) => (
    <Controller
      control={control}
      name={id}
      render={({ field }) => <textarea aria-label="Description" {...field} />}
    />
  ));
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  queryClient?.clear();
  vi.restoreAllMocks();
  restoreBrowserGlobals();
});

describe("poll save flows", () => {
  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({ poll: { getPolls: { invalidate } } }),
      poll: {
        getPolls: {
          useInfiniteQuery: () => ({
            data: { pages: [{ data: [poll], nextCursor: null }] },
            isLoading: false,
            fetchNextPage: async () => undefined,
            hasNextPage: false,
          }),
        },
        getUserVote: { useQuery: () => ({ data: null }) },
        createPoll: {
          useMutation: (options: UseMutationOptions<Result, Error, CreateInput>) =>
            useMutation({ ...options, mutationFn: create }),
        },
        updatePoll: {
          useMutation: (options: UseMutationOptions<Result, Error, UpdateInput>) =>
            useMutation({ ...options, mutationFn: update }),
        },
        vote: { useMutation: noMutation },
        retractVote: { useMutation: noMutation },
        addOption: { useMutation: noMutation },
        closePoll: { useMutation: noMutation },
        deletePollOption: { useMutation: noMutation },
      },
    });
    vi.spyOn(UserContext, "useUserData").mockReturnValue({
      data: { userId: "admin", role: "CONTENT-ADMIN" },
    } as never);
    vi.spyOn(UserSearchSelect, "default").mockImplementation(() => null);
  });

  it("preserves a rejected create draft for retry and leaves the editor after a committed save", async () => {
    const view = render(
      <QueryClientProvider client={queryClient}>
        <PollsPage />
      </QueryClientProvider>,
    );
    fireEvent.mouseDown(view.getByRole("tab", { name: "Create Poll" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(view.getByLabelText("Poll Title"), {
      target: { value: "Authored title" },
    });
    fireEvent.change(view.getByLabelText("Description"), {
      target: { value: "Authored description" },
    });
    fireEvent.change(view.getByPlaceholderText("Option 1"), {
      target: { value: "First option" },
    });
    fireEvent.change(view.getByPlaceholderText("Option 2"), {
      target: { value: "Second option" },
    });
    const submit = view.getByRole("button", {
      name: "Create Poll",
    }) as HTMLButtonElement;
    fireEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(submit.disabled).toBe(true));

    const rejection = {
      success: false,
      message: "You don't have permission to create polls",
    };
    await act(async () => {
      resolveSave(rejection);
    });
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(toast.showMutationToast).toHaveBeenCalledWith(rejection);
    expect(view.getByRole("alert").textContent).toBe(rejection.message);
    expect(invalidate).not.toHaveBeenCalled();
    expect((view.getByLabelText("Poll Title") as HTMLInputElement).value).toBe(
      "Authored title",
    );
    expect((view.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
      "Authored description",
    );
    expect((view.getByPlaceholderText("Option 1") as HTMLInputElement).value).toBe(
      "First option",
    );
    expect((view.getByPlaceholderText("Option 2") as HTMLInputElement).value).toBe(
      "Second option",
    );

    fireEvent.click(submit);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[0]).toEqual(create.mock.calls[0]?.[0]);
    await act(async () => {
      resolveSave({ success: true, message: "Poll created successfully" });
    });
    // A slow refresh must not leave a committed save open for resubmission.
    await waitFor(() =>
      expect(
        view.getByRole("tab", { name: "Active Polls" }).getAttribute("aria-selected"),
      ).toBe("true"),
    );
    expect(invalidate).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRefresh();
    });
  });

  it("keeps a rejected edit open with its draft, then closes it after a successful retry", async () => {
    const view = render(
      <QueryClientProvider client={queryClient}>
        <PollsPage />
      </QueryClientProvider>,
    );
    fireEvent.click(view.getByRole("button", { name: "Edit poll" }));
    fireEvent.change(view.getByLabelText("Title"), {
      target: { value: "Revised title" },
    });
    fireEvent.change(view.getByLabelText("Description"), {
      target: { value: "Revised description" },
    });
    fireEvent.click(view.getByRole("button", { name: "Update Poll" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "Updating..." }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );

    const rejection = { success: false, message: "Poll not found" };
    await act(async () => {
      resolveSave(rejection);
    });
    await waitFor(() =>
      expect(
        (view.getByRole("button", { name: "Update Poll" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(toast.showMutationToast).toHaveBeenCalledWith(rejection);
    expect(view.getByRole("alert").textContent).toBe(rejection.message);
    expect(invalidate).not.toHaveBeenCalled();
    expect(view.getByRole("dialog")).toBeDefined();
    expect((view.getByLabelText("Title") as HTMLInputElement).value).toBe(
      "Revised title",
    );
    expect((view.getByLabelText("Description") as HTMLTextAreaElement).value).toBe(
      "Revised description",
    );

    expect(update.mock.calls[0]?.[0]).toStrictEqual({
      id: "poll-1",
      title: "Revised title",
      description: "Revised description",
      allowCustomOptions: true,
    });
    fireEvent.click(view.getByRole("button", { name: "Update Poll" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]?.[0]).toEqual(update.mock.calls[0]?.[0]);
    await act(async () => {
      resolveSave({ success: true, message: "Poll updated successfully" });
    });
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
    expect(invalidate).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRefresh();
    });
  });
});

describe("poll list", () => {
  const closePoll = vi.fn();
  const option = {
    id: "option-1",
    pollId: "poll-1",
    text: "Yes",
    optionType: "text",
    targetUserId: null,
    createdByUserId: "someone",
    createdBy: { userId: "someone", username: "Someone", avatar: null },
    createdAt: new Date(),
    targetUser: null,
    voteCount: 2,
    percentage: 100,
  };
  const second = {
    ...poll,
    id: "poll-2",
    title: "Second title",
    totalVotes: 3,
    options: [option],
  };
  const closed = { ...poll, id: "poll-3", title: "Closed title", isActive: false };

  beforeEach(() => {
    queryClient = new QueryClient();
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({ poll: { getPolls: { invalidate } } }),
      poll: {
        getPolls: {
          useInfiniteQuery: () => ({
            data: { pages: [{ data: [poll, second, closed], nextCursor: null }] },
            isLoading: false,
            fetchNextPage: async () => undefined,
            hasNextPage: false,
          }),
        },
        getUserVote: { useQuery: () => ({ data: null }) },
        createPoll: { useMutation: noMutation },
        updatePoll: { useMutation: noMutation },
        vote: { useMutation: noMutation },
        retractVote: { useMutation: noMutation },
        addOption: { useMutation: noMutation },
        closePoll: { useMutation: () => ({ mutate: closePoll, isPending: false }) },
        deletePollOption: { useMutation: noMutation },
      },
    });
    vi.spyOn(UserContext, "useUserData").mockReturnValue({
      data: { userId: "admin", role: "CONTENT-ADMIN" },
    } as never);
    vi.spyOn(UserSearchSelect, "default").mockImplementation(() => null);
  });

  const header = (view: ReturnType<typeof render>, title: string) =>
    view.getByRole("heading", { name: title }).closest("button") as HTMLButtonElement;

  it("opens the first active poll, switches on click and keeps an open poll open", () => {
    const view = render(
      <QueryClientProvider client={queryClient}>
        <PollsPage />
      </QueryClientProvider>,
    );
    const date = format(poll.createdAt, "PPP");
    expect(header(view, "Original title").getAttribute("aria-expanded")).toBe("true");
    expect(header(view, "Original title").textContent).toContain(
      `Created by Admin • ${date} • 0 votes`,
    );
    expect(header(view, "Second title").getAttribute("aria-expanded")).toBe("false");
    expect(header(view, "Second title").textContent).toContain(
      `Created by Admin • ${date} • 3 votes`,
    );

    fireEvent.click(header(view, "Second title"));
    expect(header(view, "Second title").getAttribute("aria-expanded")).toBe("true");
    expect(header(view, "Original title").getAttribute("aria-expanded")).toBe("false");
    expect(view.getByText("Yes")).toBeDefined();
    fireEvent.click(header(view, "Second title"));
    expect(header(view, "Second title").getAttribute("aria-expanded")).toBe("true");
  });

  it("offers closing an active poll from the results and the voting view", () => {
    const view = render(
      <QueryClientProvider client={queryClient}>
        <PollsPage />
      </QueryClientProvider>,
    );
    const results = view.getByRole("button", { name: "Close Poll" });
    expect(results.className).toContain("bg-destructive");
    fireEvent.click(results);
    fireEvent.click(view.getByRole("button", { name: "Vote Now" }));
    const voting = view.getByRole("button", { name: "Close Poll" });
    expect(voting).not.toBe(results);
    expect(voting.className).toBe(results.className);
    fireEvent.click(voting);
    expect(closePoll.mock.calls).toEqual([
      [{ id: "poll-1", isActive: false }],
      [{ id: "poll-1", isActive: false }],
    ]);
  });

  it("offers reopening a closed poll from its results", () => {
    const view = render(
      <QueryClientProvider client={queryClient}>
        <PollsPage />
      </QueryClientProvider>,
    );
    fireEvent.mouseDown(view.getByRole("tab", { name: "Closed Polls" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(header(view, "Closed title").getAttribute("aria-expanded")).toBe("true");
    expect(header(view, "Closed title").textContent).toContain("0 votes • Closed");
    const reopen = view.getByRole("button", { name: "Reopen Poll" });
    expect(reopen.className).toContain("bg-primary");
    expect(view.queryByRole("button", { name: "Vote Now" })).toBeNull();
    fireEvent.click(reopen);
    expect(closePoll).toHaveBeenCalledWith({ id: "poll-3", isActive: true });
  });
});

function renderPollForm() {
  const view = render(<PollsPage />);
  fireEvent.change(view.getByPlaceholderText("Enter poll title"), {
    target: { value: "Village names" },
  });
  fireEvent.change(view.getByRole("textbox", { name: "Description" }), {
    target: { value: "Choose a name for the village" },
  });
  return view;
}

describe("poll creation form options", () => {
  beforeEach(() => {
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => ({ poll: { getPolls: { invalidate: invalidateForm } } }),
      poll: {
        getPolls: {
          useInfiniteQuery: () => ({
            data: { pages: [{ data: [], nextCursor: null }] },
            isLoading: false,
            fetchNextPage: async () => undefined,
            hasNextPage: false,
          }),
        },
        createPoll: {
          useMutation: (options: { onSuccess: typeof onSuccess }) => {
            onSuccess = options.onSuccess;
            return { mutate: createPollForm, isPending: false };
          },
        },
      },
      profile: { searchUsers: { useQuery: () => ({ data: players }) } },
    });
    vi.spyOn(UserContext, "useUserData").mockReturnValue({
      data: { role: "OWNER" },
    } as never);
    vi.spyOn(Avatar, "default").mockImplementation(() => null);
    // Keep the create tab mounted so success exercises reset on the same form instance.
    vi.spyOn(tabs, "TabsContent").mockImplementation(
      Object.assign(
        ({ children }: ComponentProps<typeof tabs.TabsContent>) => (
          <div>{children}</div>
        ),
        { displayName: tabs.TabsContent.displayName },
      ),
    );
  });

  it("shows a correction and sends no mutation for two blank options", async () => {
    const view = renderPollForm();
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() =>
      expect(view.getByText("Add at least two non-empty poll options")).toBeDefined(),
    );
    expect(createPollForm).not.toHaveBeenCalled();
    fireEvent.change(view.getByPlaceholderText("Option 1"), {
      target: { value: "  One  " },
    });
    fireEvent.change(view.getByPlaceholderText("Option 2"), {
      target: { value: "Two" },
    });
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(createPollForm).toHaveBeenCalledTimes(1));
    expect(createPollForm.mock.calls[0]?.[0].options).toEqual([
      { type: "text", text: "One" },
      { type: "text", text: "Two" },
    ]);
  });

  it("keeps surviving text inputs stable after removing a middle row", async () => {
    const view = renderPollForm();
    fireEvent.change(view.getByPlaceholderText("Option 1"), {
      target: { value: "One" },
    });
    fireEvent.click(view.getByRole("button", { name: "Add Text Option" }));
    const lastInput = view.getByPlaceholderText("Option 3");
    fireEvent.change(lastInput, { target: { value: "Three" } });
    fireEvent.click(view.getByRole("button", { name: "Remove option 2" }));
    expect(view.getByPlaceholderText("Option 2")).toBe(lastInput);
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(createPollForm).toHaveBeenCalledTimes(1));
    expect(createPollForm.mock.calls[0]?.[0].options).toEqual([
      { type: "text", text: "One" },
      { type: "text", text: "Three" },
    ]);
  });

  it("supports user-only polls and validates again when a user is removed", async () => {
    const view = renderPollForm();
    fireEvent.click(view.getByRole("radio", { name: "User" }));
    const search = view.getByPlaceholderText("Search for users to add as options");
    for (const name of ["Player One", "Player Two"]) {
      fireEvent.change(search, { target: { value: "Player" } });
      fireEvent.click(view.getByRole("button", { name: new RegExp(name) }));
    }
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(createPollForm).toHaveBeenCalledTimes(1));
    expect(createPollForm.mock.calls[0]?.[0].options).toEqual([
      { type: "user", userId: "user-1", username: "Player One" },
      { type: "user", userId: "user-2", username: "Player Two" },
    ]);
    const removeUser = view.getByText("Player One").parentElement?.querySelector("svg");
    expect(removeUser).toBeTruthy();
    fireEvent.click(removeUser!);
    await waitFor(() =>
      expect(view.getByRole("alert").textContent).toBe(
        "Add at least two non-empty poll options",
      ),
    );
    expect(createPollForm).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole("radio", { name: "Text" }));
    fireEvent.change(view.getByPlaceholderText("Option 2"), {
      target: { value: "Two" },
    });
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(createPollForm).toHaveBeenCalledTimes(2));
    expect(createPollForm.mock.calls[1]?.[0].options).toEqual([
      { type: "text", text: "Two" },
      { type: "user", userId: "user-2", username: "Player Two" },
    ]);
  });

  it("submits mixed options once per user and resets text and selected users", async () => {
    const view = renderPollForm();
    fireEvent.change(view.getByPlaceholderText("Option 1"), {
      target: { value: "  One " },
    });
    fireEvent.click(view.getByRole("radio", { name: "User" }));
    const search = view.getByPlaceholderText("Search for users to add as options");
    fireEvent.change(search, { target: { value: "Player" } });
    fireEvent.click(view.getByRole("button", { name: /Player One/ }));
    fireEvent.change(search, { target: { value: "Player" } });
    fireEvent.click(view.getByRole("button", { name: /Player One/ }));
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(createPollForm).toHaveBeenCalledTimes(1));
    expect(createPollForm.mock.calls[0]?.[0].options).toEqual([
      { type: "text", text: "One" },
      { type: "user", userId: "user-1", username: "Player One" },
    ]);
    await act(() => onSuccess({ success: false, message: "Permission changed" }));
    expect(view.getByText("Player One")).toBeDefined();
    expect(
      (view.getByPlaceholderText("Enter poll title") as HTMLInputElement).value,
    ).toBe("Village names");
    await act(() => onSuccess({ success: true, message: "Created" }));
    expect(view.queryByText("Player One")).toBeNull();
    fireEvent.click(view.getByRole("radio", { name: "Text" }));
    expect((view.getByPlaceholderText("Option 1") as HTMLInputElement).value).toBe("");
    expect((view.getByPlaceholderText("Option 2") as HTMLInputElement).value).toBe("");
  });
});

describe("poll user options", () => {
  beforeEach(() => {
    const utils = { poll: { getPolls: { invalidate: vi.fn() } } };
    Object.assign(vi.spyOn(client, "api" as never), {
      useUtils: () => utils,
      poll: {
        getPolls: {
          useInfiniteQuery: () => ({
            data: { pages: [{ data: [], nextCursor: null }] },
            isLoading: false,
            fetchNextPage: async () => undefined,
            hasNextPage: false,
          }),
        },
        createPoll: {
          useMutation: () => ({ mutate: createPollUsers, isPending: false }),
        },
      },
    });
    vi.spyOn(UserContext, "useUserData").mockReturnValue({
      data: { role: "OWNER" },
    } as never);
    vi.spyOn(UserSearchSelect, "default").mockImplementation(({ useFormMethods }) => (
      <>
        {["First", "Second"].map((username) => (
          <button
            key={username}
            type="button"
            onClick={() =>
              useFormMethods.setValue("users", [
                {
                  userId: username,
                  username,
                  avatar: null,
                  federalStatus: "NONE",
                  rank: "STUDENT",
                  level: 1,
                },
              ])
            }
          >
            Select {username}
          </button>
        ))}
        <button type="button" onClick={() => useFormMethods.setValue("users", [])}>
          Clear users
        </button>
      </>
    ));
  });

  it("preserves edited text options when selected users are added, replaced and removed", async () => {
    const view = render(<PollsPage />);
    fireEvent.mouseDown(view.getByRole("tab", { name: "Create Poll" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.change(view.getByPlaceholderText("Enter poll title"), {
      target: { value: "Choose a winner" },
    });
    fireEvent.change(view.getByLabelText("Description"), {
      target: { value: "Vote for your favourite." },
    });
    fireEvent.change(view.getByPlaceholderText("Option 1"), {
      target: { value: "First text" },
    });
    fireEvent.change(view.getByPlaceholderText("Option 2"), {
      target: { value: "Second text" },
    });
    fireEvent.click(view.getByRole("button", { name: "Add Text Option" }));
    fireEvent.change(view.getByPlaceholderText("Option 3"), {
      target: { value: "Third text" },
    });

    fireEvent.click(view.getByRole("radio", { name: "User" }));
    fireEvent.click(view.getByRole("button", { name: "Select First" }));
    fireEvent.click(view.getByRole("button", { name: "Select Second" }));
    fireEvent.click(view.getByRole("button", { name: "Clear users" }));
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(createPollUsers).toHaveBeenCalledTimes(1));
    expect(createPollUsers.mock.calls[0]?.[0].options).toEqual([
      { type: "text", text: "First text" },
      { type: "text", text: "Second text" },
      { type: "text", text: "Third text" },
    ]);

    fireEvent.click(view.getByRole("button", { name: "Select Second" }));
    fireEvent.click(view.getByRole("radio", { name: "Text" }));
    expect((view.getByPlaceholderText("Option 3") as HTMLInputElement).value).toBe(
      "Third text",
    );
    fireEvent.change(view.getByPlaceholderText("Option 2"), {
      target: { value: "Edited text" },
    });
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(createPollUsers).toHaveBeenCalledTimes(2));
    expect(createPollUsers.mock.calls[1]?.[0].options).toEqual([
      { type: "text", text: "First text" },
      { type: "text", text: "Edited text" },
      { type: "text", text: "Third text" },
      expect.objectContaining({ type: "user", userId: "Second", username: "Second" }),
    ]);
  });
});
