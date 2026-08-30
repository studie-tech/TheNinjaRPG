import { ensureDom } from "../setup-dom.mjs";
import { render } from "@testing-library/react";
import type { HTMLAttributes, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Modal2, {
  modalScrollableBodyClassName,
  modalViewportClassName,
} from "@/layout/Modal2";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
    open ? children : null,
  DialogContent: ({
    className,
    children,
    id,
  }: HTMLAttributes<HTMLDivElement> & { id?: string }) => (
    <div role="dialog" id={id} className={className}>
      {children}
    </div>
  ),
  DialogHeader: ({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  DialogFooter: ({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  DialogTitle: ({
    className,
    children,
    ...props
  }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className={className} {...props}>
      {children}
    </h2>
  ),
}));

describe("Modal2", () => {
  beforeEach(ensureDom);

  it("keeps the footer outside the scrollable body on small viewports", () => {
    const { getByRole } = render(
      <Modal2 isOpen setIsOpen={vi.fn()} title="Test Modal">
        Scrollable body content
      </Modal2>,
    );

    const dialog = getByRole("dialog");
    for (const className of modalViewportClassName.split(" ")) {
      expect(dialog.className).toContain(className);
    }

    const [header, scrollableBody, footer] = Array.from(dialog.children);
    expect(header?.querySelector("h2")?.textContent).toBe("Test Modal");
    expect(scrollableBody).not.toBeNull();
    for (const className of modalScrollableBodyClassName.split(" ")) {
      expect(scrollableBody?.className).toContain(className);
    }
    expect(scrollableBody?.textContent).toContain("Scrollable body content");

    const closeButton = getByRole("button", { name: "Close" });
    expect(footer).not.toBeNull();
    expect(footer?.contains(closeButton)).toBe(true);
    expect(scrollableBody?.nextElementSibling).toBe(footer);
    expect(scrollableBody?.contains(closeButton)).toBe(false);
  });
});
