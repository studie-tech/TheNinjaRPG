import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import type { Control } from "react-hook-form";
import { useController } from "react-hook-form";
import * as contentBox from "@/layout/ContentBox";
import { GroupOrders } from "@/layout/GroupOrders";
import * as modal from "@/layout/Modal";
import * as richInput from "@/layout/RichInput";
import type { MutateContentSchema } from "@/validators/comments";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(contentBox, "default").mockImplementation((({
    topRightContent,
    children,
  }: {
    topRightContent: ReactNode;
    children: ReactNode;
  }) => (
    <>
      {topRightContent}
      {children}
    </>
  )) as never);
});

const Draft = ({
  control,
  error,
}: {
  control: Control<MutateContentSchema>;
  error?: string;
}) => {
  const { field } = useController({ control, name: "content" });
  return (
    <>
      <textarea aria-label="Draft" {...field} />
      {error && <p role="alert">{error}</p>}
    </>
  );
};

const setup = (
  props: Partial<ComponentProps<typeof GroupOrders>> &
    Pick<ComponentProps<typeof GroupOrders>, "onSubmit">,
) => {
  vi.spyOn(modal, "default").mockImplementation((({
    isOpen,
    onAccept,
    children,
  }: {
    isOpen: boolean;
    onAccept: () => void;
    children: ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog">
        {children}
        <button type="button" onClick={onAccept}>
          Submit
        </button>
      </div>
    ) : null) as never);
  vi.spyOn(richInput, "default").mockImplementation(Draft as never);
  const view = render(
    <GroupOrders
      title="Orders"
      subtitle="From leader"
      content="<p>Current orders</p>"
      canPost
      isPending={false}
      renderTrigger={(open) => (
        <button type="button" onClick={open}>
          Edit
        </button>
      )}
      {...props}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Edit" }));
  const draft = view.getByRole("textbox", { name: "Draft" }) as HTMLTextAreaElement;
  return { view, draft };
};

it("keeps the dialog and draft after a refused or failed submission", async () => {
  const onSubmit = vi
    .fn()
    .mockResolvedValueOnce({ success: false })
    .mockRejectedValueOnce(new Error("Lost"))
    .mockResolvedValueOnce({ success: true });
  const { view, draft } = setup({ onSubmit });
  fireEvent.change(draft, { target: { value: "New orders" } });
  fireEvent.click(view.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      (view.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(view.getByRole("textbox", { name: "Draft" })).toHaveProperty(
    "value",
    "New orders",
  );

  fireEvent.click(view.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve));
  expect(view.getByRole("textbox", { name: "Draft" })).toHaveProperty(
    "value",
    "New orders",
  );

  fireEvent.click(view.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(onSubmit).toHaveBeenLastCalledWith({ content: "New orders" });
});

it("submits one draft at a time", async () => {
  let finish: (value: { success: boolean }) => void = () => undefined;
  const onSubmit = vi.fn(
    () =>
      new Promise<{ success: boolean }>((resolve) => {
        finish = resolve;
      }),
  );
  const { view } = setup({ onSubmit });
  fireEvent.click(view.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  fireEvent.click(view.getByRole("button", { name: "Submit" }));
  await new Promise((resolve) => setTimeout(resolve));
  expect(onSubmit).toHaveBeenCalledTimes(1);
  finish({ success: true });
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
});

it("reports an invalid draft in the open dialog without submitting", async () => {
  const onSubmit = vi.fn(async () => ({ success: true }));
  const { view } = setup({ onSubmit, draft: "" });
  expect(view.getByRole("textbox", { name: "Draft" })).toHaveProperty("value", "");
  fireEvent.click(view.getByRole("button", { name: "Submit" }));
  await waitFor(() => expect(view.getByRole("alert")).toBeDefined());
  expect(onSubmit).not.toHaveBeenCalled();
  expect(view.getByRole("dialog")).toBeDefined();
});

it("hides the editor from readers", () => {
  vi.spyOn(modal, "default").mockImplementation((() => <div role="dialog" />) as never);
  const view = render(
    <GroupOrders
      title="Orders"
      subtitle="From leader"
      content="<p>Current orders</p>"
      canPost={false}
      isPending={false}
      onSubmit={vi.fn()}
      renderTrigger={() => <button type="button">Edit</button>}
    >
      <span>Footer</span>
    </GroupOrders>,
  );
  expect(view.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.getByText("Current orders")).toBeDefined();
  expect(view.getByText("Footer")).toBeDefined();
});
