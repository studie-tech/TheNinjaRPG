import { afterEach, beforeEach, expect, it, type Mock, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { QuoteJump } from "@/layout/QuoteJump";
import * as toast from "@/libs/toast";
import { spyOnToasts } from "../setup/toastMock";

const toastMock = () =>
  toast.showMutationToast as unknown as Mock<typeof toast.showMutationToast>;

const scrollIntoView = vi.fn();
let original: PropertyDescriptor | undefined;

beforeEach(() => {
  scrollIntoView.mockReset();
  spyOnToasts();
  original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  if (original)
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const thread = (id: string) => (
  <div data-conversation-comments>
    <div data-comment-id="c1">Original {id}</div>
    <div data-comment-id="c2">
      <QuoteJump commentId="c1" author="Bob">
        Quoted from Bob
      </QuoteJump>
    </div>
  </div>
);

it("scrolls to the quoted message and outlines it briefly", () => {
  vi.useFakeTimers();
  const view = render(thread("tavern"));
  fireEvent.click(
    view.getByRole("button", { name: "Jump to the quoted message from Bob" }),
  );
  const target = view.getByText("Original tavern");
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  expect(scrollIntoView.mock.contexts[0]).toBe(target);
  expect(target.className).toContain("ring-2");
  act(() => vi.advanceTimersByTime(2000));
  expect(target.className).not.toContain("ring-2");
});

it("jumps within its own list when the same chat is open twice", () => {
  const view = render(
    <>
      {thread("panel")}
      {thread("page")}
    </>,
  );
  const [, second] = view.getAllByRole("button", {
    name: "Jump to the quoted message from Bob",
  });
  fireEvent.click(second!);
  expect(scrollIntoView.mock.contexts[0]).toBe(view.getByText("Original page"));
});

it("explains when the original is unavailable in this view", () => {
  const view = render(
    <QuoteJump commentId="gone" author="Bob">
      Quoted from Bob
    </QuoteJump>,
  );
  fireEvent.click(
    view.getByRole("button", { name: "Jump to the quoted message from Bob" }),
  );
  expect(scrollIntoView).not.toHaveBeenCalled();
  expect(toastMock().mock.calls[0]?.[0].title).toBe("Message unavailable");
  expect(String(toastMock().mock.calls[0]?.[0].message)).toContain(
    "loading more messages or clearing the search",
  );
});

it("does not jump to another list when the original is missing locally", () => {
  const view = render(
    <>
      {thread("page")}
      <div data-conversation-comments>
        <QuoteJump commentId="c1" author="Bob">
          Panel quote
        </QuoteJump>
      </div>
    </>,
  );
  fireEvent.click(view.getByText("Panel quote"));
  expect(scrollIntoView).not.toHaveBeenCalled();
  expect(toastMock().mock.calls[0]?.[0].title).toBe("Message unavailable");
  expect(view.getByText("Original page").className).not.toContain("ring-2");
});
