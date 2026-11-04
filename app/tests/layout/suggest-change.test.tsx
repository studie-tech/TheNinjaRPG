import { createToastMock } from "../setup/toastMock";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { HTMLAttributes, ReactNode } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as dialogComponents from "@/components/ui/dialog";
import * as UserContext from "@/utils/UserContext";

type MutationOptions = { onError?: (err: { message: string; data?: unknown }) => void };
const mutate = vi.fn();
let mutationOptions: MutationOptions = {};

vi.mock("@/app/_trpc/client", () => ({
  api: {
    useUtils: () => ({}),
    contentReview: {
      create: {
        useMutation: (options: MutationOptions) => {
          mutationOptions = options;
          return { mutate, isPending: false };
        },
      },
    },
  },
}));
vi.mock("@/libs/toast", createToastMock);
vi.mock("@radix-ui/react-use-size", () => ({
  useSize: () => ({ width: 0, height: 0 }),
}));

const { SuggestChange } = await import("@/layout/SuggestChange");

const dialogMocks = {
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open ? children : null,
  DialogContent: ({ children }: HTMLAttributes<HTMLDivElement>) => (
    <div role="dialog">{children}</div>
  ),
  DialogHeader: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  DialogFooter: ({ children }: HTMLAttributes<HTMLDivElement>) => <div>{children}</div>,
  DialogTitle: ({ children }: HTMLAttributes<HTMLHeadingElement>) => <h2>{children}</h2>,
};

const spies: { mockRestore: () => void }[] = [];
beforeEach(() => {
  mutate.mockClear();
  for (const [name, implementation] of Object.entries(dialogMocks)) {
    spies.push(
      vi
        .spyOn(dialogComponents, name as keyof typeof dialogMocks)
        .mockImplementation(implementation as never),
    );
  }
  spies.push(
    vi
      .spyOn(UserContext, "useRequiredUserData")
      .mockReturnValue({ data: { role: "CONTENT" } } as never),
  );
});
afterEach(() => {
  cleanup();
  for (const spy of spies.splice(0)) spy.mockRestore();
});

// THENINJARPG-33K: a 9-character rationale ("BL Rework") reached the server, which
// rejected it and the staffer saw the raw Zod issue JSON.
const openModal = () => {
  const view = render(
    <SuggestChange entityType="JUTSU" entityId="jutsu" getData={() => ({ name: "A" })} />,
  );
  fireEvent.click(view.getByRole("button", { name: "Suggest a change" }));
  fireEvent.change(view.getByLabelText("Title"), { target: { value: "BL Rework" } });
  return view;
};

describe("SuggestChange", () => {
  it("blocks sending while the rationale is shorter than the server accepts", () => {
    const view = openModal();
    fireEvent.change(view.getByLabelText("Why (required)"), {
      target: { value: "BL Rework" },
    });

    const send = view.getByRole("button", { name: "Send for review" });
    expect(send.hasAttribute("disabled")).toBe(true);
    expect(view.getByText("At least 10 characters (9/10)")).toBeTruthy();
    fireEvent.click(send);
    fireEvent.keyDown(document, { key: "Enter" });
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.change(view.getByLabelText("Why (required)"), {
      target: { value: "Bloodline rework pass" },
    });
    expect(send.hasAttribute("disabled")).toBe(false);
    expect(view.queryByText(/At least 10 characters/)).toBeNull();
    fireEvent.click(send);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("shows server input errors as readable text instead of Zod JSON", () => {
    const view = openModal();
    act(() =>
      mutationOptions.onError?.({
        message: '[{"origin":"string","code":"too_small","minimum":10}]',
        data: {
          zodError: [
            { origin: "string", code: "too_small", minimum: 10, path: ["rationale"] },
          ],
        },
      }),
    );
    expect(view.getByText("Rationale must be at least 10 characters.")).toBeTruthy();
    expect(view.queryByText(/too_small/)).toBeNull();
  });
});
