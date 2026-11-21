import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as supplyHook from "@/hooks/useSupplyRequest";
import * as ContentBox from "@/layout/ContentBox";
import * as Modal from "@/layout/Modal";
import { SupplyRequest } from "@/layout/SupplyRequest";
import * as UserContext from "@/utils/UserContext";

const submit = vi.fn();
const refetch = vi.fn();
const stack = {
  id: "stock",
  itemId: "herb",
  name: "Herb",
  quantity: 250,
  updatedAt: new Date("2026-11-21T10:00:00Z"),
  image: null,
  auctionMaxPrice: 11,
};
const renderDesk = (overrides = {}) => {
  vi.spyOn(supplyHook, "useSupplyRequest").mockReturnValue({
    request: {
      data: {
        occupation: "GATHERING",
        blocked: null,
        nextResetAt: new Date(Date.now() + 86400000),
        stacks: [stack],
      },
      isPending: false,
      isError: false,
      refetch,
    },
    result: undefined,
    isSubmitting: false,
    submit,
    ...overrides,
  } as never);
  return render(<SupplyRequest />);
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(UserContext, "useRequiredUserInfo").mockReturnValue({
    timeDiff: 0,
  } as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(Modal, "default").mockImplementation(({ isOpen, children, onAccept }) =>
    isOpen ? (
      <div>
        {children}
        <button type="button" onClick={(event) => onAccept?.(event)}>
          Confirm exchange
        </button>
      </div>
    ) : null,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("previews full bundles, retains the remainder and submits only after confirmation", () => {
  renderDesk();
  fireEvent.change(screen.getByLabelText("Supply stack"), {
    target: { value: "stock" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Max" }));
  expect((screen.getByLabelText(/Quantity/) as HTMLInputElement).value).toBe("200");
  expect(screen.getByText("1,320 Ryo")).toBeTruthy();
  expect(screen.getByText("4,000 gathering EXP")).toBeTruthy();
  expect(screen.getByText(/50 items remain/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Submit supplies" }));
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm exchange" }));
  expect(submit).toHaveBeenCalledWith({
    userItemId: "stock",
    quantity: 200,
    expectedQuantity: 250,
    expectedUpdatedAt: stack.updatedAt,
    occupation: "GATHERING",
    auctionMaxPrice: 11,
  });
});

it("blocks incomplete bundles and quantities above the selected stack", () => {
  renderDesk();
  fireEvent.change(screen.getByLabelText("Supply stack"), {
    target: { value: "stock" },
  });
  for (const value of ["0", "99", "150", "300"]) {
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value } });
    expect(
      (screen.getByRole("button", { name: "Submit supplies" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  }
});

it("explains a claimed reset and keeps recoverable feedback beside the action", () => {
  renderDesk({
    request: {
      data: {
        occupation: "GATHERING",
        blocked: "You have already submitted supplies this reset.",
        nextResetAt: new Date(Date.now() + 86400000),
        stacks: [stack],
      },
    },
    result: { success: false, message: "These supplies changed. Try again." },
  });
  expect(screen.getByText(/already submitted/)).toBeTruthy();
  expect(screen.queryByLabelText("Supply stack")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("These supplies changed");
});

it("offers retry when loading supplies fails", () => {
  renderDesk({
    request: {
      isPending: false,
      isError: true,
      error: { message: "Offline" },
      refetch,
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(refetch).toHaveBeenCalledTimes(1);
});
