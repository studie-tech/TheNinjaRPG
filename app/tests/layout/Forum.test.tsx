import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useController } from "react-hook-form";
import { ForumComposer, ForumSearch } from "@/layout/Forum";
import * as RichInput from "@/layout/RichInput";
import * as UserContext from "@/utils/UserContext";

const storageKey = "forum-draft:forum-draft-player:thread:topic";
beforeEach(() => {
  localStorage.removeItem(storageKey);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({
    data: { userId: "forum-draft-player", role: "USER" },
  } as never);
  vi.spyOn(RichInput, "default").mockImplementation(({ control, disabled }) => {
    const { field } = useController({ control, name: "content" });
    return <textarea aria-label="Reply message" {...field} disabled={disabled} />;
  });
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(storageKey);
  vi.restoreAllMocks();
});

it("keeps search typing separate from the applied query and restores the applied input", async () => {
  const onSearch = vi.fn();
  const view = render(<ForumSearch query="applied search" onSearch={onSearch} />);
  const input = view.getByRole("textbox", { name: "Search forum" }) as HTMLInputElement;
  expect(input.value).toBe("applied search");
  fireEvent.change(input, { target: { value: "unfinished search" } });
  expect(onSearch).not.toHaveBeenCalled();
  fireEvent.submit(view.container.querySelector("form")!);
  expect(onSearch).toHaveBeenCalledWith("unfinished search");
  view.rerender(<ForumSearch query="restored search" onSearch={onSearch} />);
  await waitFor(() => expect(input.value).toBe("restored search"));
});

it("restores a saved draft before appending a quote once and retains it after failed submission", async () => {
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      content: "<p>My saved training question.</p>",
      title: "",
      kind: "DISCUSSION",
      tags: "",
      image: "",
    }),
  );
  const onSubmit = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const props = { draftKey: "thread:topic", pending: false, uploads: false, onSubmit };
  const view = render(<ForumComposer {...props} />);
  await waitFor(() =>
    expect(view.getByText("A saved draft is available.")).toBeTruthy(),
  );
  expect(
    (view.getByRole("textbox", { name: "Reply message" }) as HTMLTextAreaElement)
      .disabled,
  ).toBe(true);
  const quote = "<blockquote>Useful training advice</blockquote><p><br></p>";
  view.rerender(<ForumComposer {...props} quote={quote} />);
  await waitFor(() =>
    expect(view.queryByText("A saved draft is available.")).toBeNull(),
  );
  const editor = view.getByRole("textbox", {
    name: "Reply message",
  }) as HTMLTextAreaElement;
  expect(editor.value).toContain("My saved training question.");
  expect(editor.value.split("Useful training advice")).toHaveLength(2);
  fireEvent.click(view.getByRole("button", { name: "Post reply" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem(storageKey)).toContain("My saved training question.");
  expect(editor.value).toContain("Useful training advice");
  fireEvent.click(view.getByRole("button", { name: "Post reply" }));
  await waitFor(() => expect(editor.value).toBe(""));
  expect(localStorage.getItem(storageKey)).toBeNull();
});
