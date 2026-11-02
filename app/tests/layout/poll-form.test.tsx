import * as useSize from "@radix-ui/react-use-size";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ComponentProps } from "react";
import { useController } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import PollsPage from "@/app/[shell]/manual/polls/page";
import * as tabs from "@/components/ui/tabs";
import * as Avatar from "@/layout/Avatar";
import * as ContentBox from "@/layout/ContentBox";
import * as RichInput from "@/layout/RichInput";
import * as pagination from "@/libs/pagination";
import * as toast from "@/libs/toast";
import * as UserContext from "@/utils/UserContext";
import type { CreatePollSchema } from "@/validators/poll";
import { ensureDom } from "../setup/dom.mjs";

type Response = { success: boolean; message: string };
let onSuccess: (response: Response) => void;
const createPoll = vi.fn((_input: CreatePollSchema) => undefined);
const invalidate = vi.fn(async () => undefined);
const players = [
  { userId: "user-1", username: "Player One", avatar: null, level: 10, rank: "GENIN", federalStatus: "NONE" },
  { userId: "user-2", username: "Player Two", avatar: null, level: 10, rank: "GENIN", federalStatus: "NONE" },
];
const originalEvent = globalThis.Event;
const originalCustomEvent = globalThis.CustomEvent;

beforeEach(() => {
  ensureDom();
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  vi.clearAllMocks();
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ poll: { getPolls: { invalidate } } }),
    poll: {
      getPolls: { useInfiniteQuery: () => ({ data: { pages: [{ data: [], nextCursor: null }] }, isLoading: false, fetchNextPage: async () => undefined, hasNextPage: false }) },
      createPoll: { useMutation: (options: { onSuccess: typeof onSuccess }) => {
        onSuccess = options.onSuccess;
        return { mutate: createPoll, isPending: false };
      } },
    },
    profile: { searchUsers: { useQuery: () => ({ data: players }) } },
  });
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role: "OWNER" } } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(Avatar, "default").mockImplementation(() => null);
  vi.spyOn(RichInput, "default").mockImplementation(({ control, id }) => {
    const { field } = useController({ control, name: id });
    return <textarea aria-label="Description" {...field} />;
  });
  vi.spyOn(toast, "showMutationToast").mockImplementation(() => undefined);
  vi.spyOn(useSize, "useSize").mockReturnValue({ width: 0, height: 0 });
  // Keep the create tab mounted so success exercises reset on the same form instance.
  vi.spyOn(tabs, "TabsContent").mockImplementation(Object.assign(
    ({ children }: ComponentProps<typeof tabs.TabsContent>) => <div>{children}</div>,
    { displayName: tabs.TabsContent.displayName },
  ));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.Event = originalEvent;
  globalThis.CustomEvent = originalCustomEvent;
});

function renderPollForm() {
  const view = render(<PollsPage />);
  fireEvent.change(view.getByPlaceholderText("Enter poll title"), { target: { value: "Village names" } });
  fireEvent.change(view.getByRole("textbox", { name: "Description" }), { target: { value: "Choose a name for the village" } });
  return view;
}

describe("poll creation form options", () => {
  it("shows a correction and sends no mutation for two blank options", async () => {
    const view = renderPollForm();
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(view.getByText("Add at least two non-empty poll options")).toBeDefined());
    expect(createPoll).not.toHaveBeenCalled();
    fireEvent.change(view.getByPlaceholderText("Option 1"), { target: { value: "  One  " } });
    fireEvent.change(view.getByPlaceholderText("Option 2"), { target: { value: "Two" } });
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(1));
    expect(createPoll.mock.calls[0]?.[0].options).toEqual([
      { type: "text", text: "One" }, { type: "text", text: "Two" },
    ]);
  });

  it("keeps surviving text inputs stable after removing a middle row", async () => {
    const view = renderPollForm();
    fireEvent.change(view.getByPlaceholderText("Option 1"), { target: { value: "One" } });
    fireEvent.click(view.getByRole("button", { name: "Add Text Option" }));
    const lastInput = view.getByPlaceholderText("Option 3");
    fireEvent.change(lastInput, { target: { value: "Three" } });
    fireEvent.click(view.getByRole("button", { name: "Remove option 2" }));
    expect(view.getByPlaceholderText("Option 2")).toBe(lastInput);
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(1));
    expect(createPoll.mock.calls[0]?.[0].options).toEqual([
      { type: "text", text: "One" }, { type: "text", text: "Three" },
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
    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(1));
    expect(createPoll.mock.calls[0]?.[0].options).toEqual([
      { type: "user", userId: "user-1", username: "Player One" },
      { type: "user", userId: "user-2", username: "Player Two" },
    ]);
    const removeUser = view.getByText("Player One").parentElement?.querySelector("svg");
    expect(removeUser).toBeTruthy();
    fireEvent.click(removeUser!);
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("Add at least two non-empty poll options"));
    expect(createPoll).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole("radio", { name: "Text" }));
    fireEvent.change(view.getByPlaceholderText("Option 2"), { target: { value: "Two" } });
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(2));
    expect(createPoll.mock.calls[1]?.[0].options).toEqual([
      { type: "text", text: "Two" },
      { type: "user", userId: "user-2", username: "Player Two" },
    ]);
  });

  it("submits mixed options once per user and resets text and selected users", async () => {
    const view = renderPollForm();
    fireEvent.change(view.getByPlaceholderText("Option 1"), { target: { value: "  One " } });
    fireEvent.click(view.getByRole("radio", { name: "User" }));
    const search = view.getByPlaceholderText("Search for users to add as options");
    fireEvent.change(search, { target: { value: "Player" } });
    fireEvent.click(view.getByRole("button", { name: /Player One/ }));
    fireEvent.change(search, { target: { value: "Player" } });
    fireEvent.click(view.getByRole("button", { name: /Player One/ }));
    fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
    await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(1));
    expect(createPoll.mock.calls[0]?.[0].options).toEqual([
      { type: "text", text: "One" },
      { type: "user", userId: "user-1", username: "Player One" },
    ]);
    await act(() => onSuccess({ success: false, message: "Permission changed" }));
    expect(view.getByText("Player One")).toBeDefined();
    expect((view.getByPlaceholderText("Enter poll title") as HTMLInputElement).value).toBe("Village names");
    await act(() => onSuccess({ success: true, message: "Created" }));
    expect(view.queryByText("Player One")).toBeNull();
    fireEvent.click(view.getByRole("radio", { name: "Text" }));
    expect((view.getByPlaceholderText("Option 1") as HTMLInputElement).value).toBe("");
    expect((view.getByPlaceholderText("Option 2") as HTMLInputElement).value).toBe("");
  });
});
