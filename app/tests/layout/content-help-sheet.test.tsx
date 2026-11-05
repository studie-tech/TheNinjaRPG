import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import * as sheet from "@/components/ui/sheet";
import * as mediaQuery from "@/hooks/useMediaQuery";
import { BloodlineHelper } from "@/layout/ContentHelp";
import * as UserContext from "@/utils/UserContext";

let isDesktop: boolean;

beforeEach(() => {
  isDesktop = true;
  vi.spyOn(mediaQuery, "useMediaQuery").mockImplementation(() => isDesktop);
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
      <button type="button" onClick={() => onOpenChange(false)}>
        close
      </button>
      {children}
    </div>
  )) as never);
  vi.spyOn(sheet, "SheetTrigger").mockImplementation((() => null) as never);
  vi.spyOn(sheet, "SheetContent").mockImplementation((({
    children,
  }: {
    children: ReactNode;
  }) => <div>{children}</div>) as never);
  vi.spyOn(sheet, "SheetHeader").mockImplementation((() => null) as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("content helper sheet", () => {
  const helper = <BloodlineHelper bloodline={{ name: "Sharingan", rank: "A" }} />;

  it("starts open on desktop and closed on mobile", () => {
    const desktop = render(helper);
    expect(desktop.getByTestId("sheet").dataset.open).toBe("true");
    expect(desktop.getByText("Bloodline: Sharingan")).toBeTruthy();
    cleanup();
    isDesktop = false;
    const mobile = render(helper);
    expect(mobile.getByTestId("sheet").dataset.open).toBe("false");
  });

  it("stays closed across a resize that does not cross the breakpoint", () => {
    const view = render(helper);
    fireEvent.click(view.getByText("close"));
    act(() => {
      window.dispatchEvent(new window.Event("resize"));
    });
    expect(view.getByTestId("sheet").dataset.open).toBe("false");
  });

  it("follows the breakpoint", () => {
    isDesktop = false;
    const view = render(helper);
    isDesktop = true;
    view.rerender(<BloodlineHelper bloodline={{ name: "Sharingan", rank: "A" }} />);
    expect(view.getByTestId("sheet").dataset.open).toBe("true");
  });
});
