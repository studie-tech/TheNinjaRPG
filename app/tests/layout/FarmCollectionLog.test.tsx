import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FarmCollectionLog } from "@/layout/FarmCollectionLog";
import * as Image from "@/layout/Image";
import { stubDialog } from "../setup/dialog";

let restoreDialog: () => void;
beforeEach(() => {
  restoreDialog = stubDialog();
  vi.spyOn(Image, "default").mockImplementation(((props: ComponentProps<"img">) => (
    <img {...props} />
  )) as never);
});
afterEach(() => {
  restoreDialog();
  vi.restoreAllMocks();
});

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
