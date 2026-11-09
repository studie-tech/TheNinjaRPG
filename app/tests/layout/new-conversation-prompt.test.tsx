import { afterEach, expect, it, vi } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Dispatch, SetStateAction } from "react";
import * as clientModule from "@/app/_trpc/client";
import * as modal from "@/layout/Modal";
import { NewConversationPrompt } from "@/layout/NewConversationPrompt";
import * as userContext from "@/utils/UserContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("notifies its parent after a committed dialog change and preserves queued functional toggles", () => {
  Object.assign(vi.spyOn(clientModule, "api" as never), {
    useUtils: () => ({
      comments: { getUserConversations: { invalidate: vi.fn() } },
    }),
    comments: {
      createConversation: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
  });
  vi.spyOn(userContext, "useRequiredUserData").mockReturnValue({
    data: {
      userId: "me",
      role: "USER",
      level: 50,
      rank: "CHUNIN",
      isBanned: false,
      isSilenced: false,
    },
  } as never);
  const events: boolean[] = [];
  let committed = false;
  vi.spyOn(modal, "default").mockImplementation(
    ({
      isOpen,
      setIsOpen,
    }: {
      isOpen: boolean;
      setIsOpen: Dispatch<SetStateAction<boolean>>;
    }) => {
      committed = false;
      return (
        <>
          <span
            ref={() => {
              committed = true;
            }}
          >
            {String(isOpen)}
          </span>
          <button
            type="button"
            onClick={() => {
              setIsOpen((current) => !current);
              setIsOpen((current) => !current);
            }}
          >
            Toggle twice
          </button>
          <button type="button" onClick={() => setIsOpen((current) => !current)}>
            Toggle once
          </button>
        </>
      );
    },
  );
  const queryClient = new QueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <NewConversationPrompt
        newButton="New chat"
        onOpenChange={(open) => {
          expect(committed).toBe(true);
          events.push(open);
        }}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(view.getByRole("button", { name: "Toggle twice" }));
  expect(events).toEqual([]);
  fireEvent.click(view.getByRole("button", { name: "Toggle once" }));
  expect(events).toEqual([true]);
  fireEvent.click(view.getByRole("button", { name: "Toggle twice" }));
  expect(events).toEqual([true]);
  fireEvent.click(view.getByRole("button", { name: "Toggle once" }));
  expect(events).toEqual([true, false]);
});
