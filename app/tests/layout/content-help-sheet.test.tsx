import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import * as sheet from "@/components/ui/sheet";
import { BloodlineHelper } from "@/layout/ContentHelp";
import * as UserContext from "@/utils/UserContext";

beforeEach(() => {
  vi.spyOn(UserContext, "useRequiredUserData").mockReturnValue({
    data: { role: "CONTENT-ADMIN" },
  } as never);
  vi.spyOn(sheet, "Sheet").mockImplementation((({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    children: ReactNode;
  }) => (
    <div data-testid="sheet" data-open={open}>
      <button type="button" onClick={() => onOpenChange(true)}>
        open
      </button>
      <button type="button" onClick={() => onOpenChange(false)}>
        close
      </button>
      {children}
    </div>
  )) as never);
  vi.spyOn(sheet, "SheetTrigger").mockImplementation((() => null) as never);
  vi.spyOn(sheet, "SheetContent").mockImplementation((({
    children,
    onEscapeKeyDown,
    onInteractOutside,
  }: {
    children: ReactNode;
    onEscapeKeyDown?: unknown;
    onInteractOutside?: unknown;
  }) => (
    <div
      data-testid="content"
      data-blocks-escape={onEscapeKeyDown !== undefined}
      data-blocks-outside={onInteractOutside !== undefined}
    >
      {children}
    </div>
  )) as never);
  vi.spyOn(sheet, "SheetHeader").mockImplementation((() => null) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("content helper sheet", () => {
  const helper = <BloodlineHelper bloodline={{ name: "Sharingan", rank: "A" }} />;

  it("starts closed and opens on request", () => {
    const view = render(helper);
    expect(view.getByTestId("sheet").dataset.open).toBe("false");
    fireEvent.click(view.getByText("open"));
    expect(view.getByTestId("sheet").dataset.open).toBe("true");
    expect(view.getByText("Bloodline: Sharingan")).toBeTruthy();
    fireEvent.click(view.getByText("close"));
    expect(view.getByTestId("sheet").dataset.open).toBe("false");
  });

  it("leaves Esc and outside clicks to dismiss the sheet", () => {
    const content = render(helper).getByTestId("content");
    expect(content.dataset.blocksEscape).toBe("false");
    expect(content.dataset.blocksOutside).toBe("false");
  });
});
