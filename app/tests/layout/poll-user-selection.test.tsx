import * as useSize from "@radix-ui/react-use-size";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { Controller } from "react-hook-form";
import * as client from "@/app/_trpc/client";
import PollsPage from "@/app/[shell]/manual/polls/page";
import * as ContentBox from "@/layout/ContentBox";
import * as RichInput from "@/layout/RichInput";
import * as UserSearchSelect from "@/layout/UserSearchSelect";
import * as pagination from "@/libs/pagination";
import * as UserContext from "@/utils/UserContext";
import type { CreatePollSchema } from "@/validators/poll";

const createPoll = vi.fn<(data: CreatePollSchema) => void>();
const originalEvent = globalThis.Event;
const originalCustomEvent = globalThis.CustomEvent;

beforeEach(() => {
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  createPoll.mockClear();
  vi.spyOn(useSize, "useSize").mockReturnValue({ width: 0, height: 0 });
  const utils = { poll: { getPolls: { invalidate: vi.fn() } } };
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => utils,
    poll: {
      getPolls: { useInfiniteQuery: () => ({ data: { pages: [{ data: [], nextCursor: null }] }, isLoading: false, fetchNextPage: async () => undefined, hasNextPage: false }) },
      createPoll: { useMutation: () => ({ mutate: createPoll, isPending: false }) },
    },
  });
  vi.spyOn(pagination, "useInfinitePagination").mockImplementation(() => undefined);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role: "OWNER" } } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <>{children}</>);
  vi.spyOn(RichInput, "default").mockImplementation(({ control, id }) => (
    <Controller control={control} name={id} render={({ field }) => <textarea aria-label="Description" {...field} />} />
  ));
  vi.spyOn(UserSearchSelect, "default").mockImplementation(({ useFormMethods }) => (
    <>
      {["First", "Second"].map((username) => (
        <button key={username} type="button" onClick={() => useFormMethods.setValue("users", [{ userId: username, username, avatar: null, federalStatus: "NONE", rank: "STUDENT", level: 1 }])}>
          Select {username}
        </button>
      ))}
      <button type="button" onClick={() => useFormMethods.setValue("users", [])}>Clear users</button>
    </>
  ));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.Event = originalEvent;
  globalThis.CustomEvent = originalCustomEvent;
});

it("preserves edited text options when selected users are added, replaced and removed", async () => {
  const view = render(<PollsPage />);
  fireEvent.mouseDown(view.getByRole("tab", { name: "Create Poll" }), { button: 0, ctrlKey: false });
  fireEvent.change(view.getByPlaceholderText("Enter poll title"), { target: { value: "Choose a winner" } });
  fireEvent.change(view.getByLabelText("Description"), { target: { value: "Vote for your favourite." } });
  fireEvent.change(view.getByPlaceholderText("Option 1"), { target: { value: "First text" } });
  fireEvent.change(view.getByPlaceholderText("Option 2"), { target: { value: "Second text" } });
  fireEvent.click(view.getByRole("button", { name: "Add Text Option" }));
  fireEvent.change(view.getByPlaceholderText("Option 3"), { target: { value: "Third text" } });

  fireEvent.click(view.getByRole("radio", { name: "User" }));
  fireEvent.click(view.getByRole("button", { name: "Select First" }));
  fireEvent.click(view.getByRole("button", { name: "Select Second" }));
  fireEvent.click(view.getByRole("button", { name: "Clear users" }));
  fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
  await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(1));
  expect(createPoll.mock.calls[0]?.[0].options).toEqual([
    { type: "text", text: "First text" },
    { type: "text", text: "Second text" },
    { type: "text", text: "Third text" },
  ]);

  fireEvent.click(view.getByRole("button", { name: "Select Second" }));
  fireEvent.click(view.getByRole("radio", { name: "Text" }));
  expect((view.getByPlaceholderText("Option 3") as HTMLInputElement).value).toBe("Third text");
  fireEvent.change(view.getByPlaceholderText("Option 2"), { target: { value: "Edited text" } });
  fireEvent.click(view.getByRole("button", { name: "Create Poll" }));
  await waitFor(() => expect(createPoll).toHaveBeenCalledTimes(2));
  expect(createPoll.mock.calls[1]?.[0].options).toEqual([
    { type: "text", text: "First text" },
    { type: "text", text: "Edited text" },
    { type: "text", text: "Third text" },
    expect.objectContaining({ type: "user", userId: "Second", username: "Second" }),
  ]);
});
