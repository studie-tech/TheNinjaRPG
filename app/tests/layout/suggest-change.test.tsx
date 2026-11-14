import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as useSize from "@radix-ui/react-use-size";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import * as client from "@/app/_trpc/client";
import { SuggestChange } from "@/layout/SuggestChange";
import { stubDialog } from "../setup/dialog";
import { spyOnToasts } from "../setup/toastMock";
import { mockUserContextValue } from "../setup/userContext";

type MutationOptions = { onError?: (err: { message: string; data?: unknown }) => void };
const mutate = vi.fn();
let mutationOptions: MutationOptions = {};

const api = {
  useUtils: () => ({}),
  contentReview: {
    create: {
      useMutation: (options: MutationOptions) => {
        mutationOptions = options;
        return { mutate, isPending: false };
      },
    },
  },
};

let restoreDialog: () => void;
beforeEach(() => {
  mutate.mockClear();
  restoreDialog = stubDialog();
  Object.assign(vi.spyOn(client, "api" as never), api);
  spyOnToasts();
  vi.spyOn(useSize, "useSize").mockReturnValue({ width: 0, height: 0 });
  mockUserContextValue({
    data: { role: "CONTENT" },
  } as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreDialog();
});

const openModal = () => {
  const view = render(
    <SuggestChange
      entityType="JUTSU"
      entityId="jutsu"
      getData={() => ({ name: "A" })}
    />,
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
