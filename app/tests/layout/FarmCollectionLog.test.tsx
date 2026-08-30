import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("@/layout/Image", () => ({
  default: (props: ComponentProps<"img">) => <img {...props} />,
}));

import { FarmCollectionLog } from "@/layout/FarmCollectionLog";

describe("FarmCollectionLog", () => {
  it("renders a responsive grid, green check, and non-color completion states", () => {
    const markup = renderToStaticMarkup(
      <FarmCollectionLog
        collectionLog={{
          collected: 1,
          total: 2,
          items: [
            {
              itemId: "carrot",
              name: "Carrot",
              image: "/carrot.png",
              harvested: true,
              firstHarvestedAt: new Date("2026-08-01T12:00:00.000Z"),
            },
            {
              itemId: "onion",
              name: "Onion",
              image: "/onion.png",
              harvested: false,
              firstHarvestedAt: null,
            },
          ],
        }}
        isOpen
        setIsOpen={vi.fn()}
      />,
    );

    expect(markup).toContain("grid-cols-2");
    expect(markup).toContain("sm:grid-cols-3");
    expect(markup).toContain('data-testid="collection-check-carrot"');
    expect(markup).toContain("bg-emerald-600");
    expect(markup).toContain("Not yet harvested");
    expect(markup).toContain("Collected");
    expect(markup).toContain('alt="Onion"');
    expect(markup).toContain("grayscale");
  });
});
