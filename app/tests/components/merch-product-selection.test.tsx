import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { MerchProductPage } from "@/components/merch/MerchProductPage";
import { merchProductSchema } from "@/validators/merch";
import { ensureDom } from "../setup-dom.mjs";

vi.mock("@/layout/Image", () => ({ default: () => null }));
vi.mock("@/layout/Link", () => ({
  default: (props: ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@/layout/Table", () => ({ default: () => null }));
vi.mock("@/components/merch/MerchCollection", () => ({ MerchProductCard: () => null }));
vi.mock("@/components/merch/MerchProvider", () => ({
  useMerch: () => ({
    products: [product], loading: false, error: false, retry: vi.fn(),
    preview: false, busy: false, message: "", add: vi.fn(),
  }),
}));

const product = merchProductSchema.parse({
  id: "shirt", handle: "shirt", title: "Shirt", designKey: "test",
  designName: "Shirt", category: "Community", kind: "Organic T-Shirt",
  description: "A shirt.", images: [], preview: false, tags: [],
  options: [{ name: "Color", values: ["Black", "Red"] },
    { name: "Size", values: ["S", "M"] }],
  variants: [
    { id: "black-s", title: "Black / S", available: true, price: null, image: null,
      selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "S" }] },
    { id: "black-m", title: "Black / M", available: true, price: null, image: null,
      selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "M" }] },
    { id: "red-m", title: "Red / M", available: true, price: null, image: null,
      selectedOptions: [{ name: "Color", value: "Red" }, { name: "Size", value: "M" }] },
  ],
});

afterEach(cleanup);
beforeEach(ensureDom);

describe("merch colour changes", () => {
  it("explains an incompatible size reset and requires another size before purchase", () => {
    const page = render(<MerchProductPage handle="shirt" />);
    fireEvent.click(page.getByRole("button", { name: "Black" }));
    fireEvent.click(page.getByRole("button", { name: "S" }));
    fireEvent.click(page.getByRole("button", { name: "Red" }));
    expect(page.getByRole("status").textContent).toContain("Red isn’t available");
    expect(page.getByRole("button", { name: "Choose your options" }).hasAttribute("disabled")).toBe(true);
    expect(page.getByRole("button", { name: "S" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(page.getByRole("button", { name: "M" }));
    expect(page.queryByRole("status")).toBeNull();
    expect(page.getByRole("button", { name: "Add to bag" }).hasAttribute("disabled")).toBe(false);
  });

  it("retains the chosen size when it is available in the new colour", () => {
    const page = render(<MerchProductPage handle="shirt" />);
    fireEvent.click(page.getByRole("button", { name: "Black" }));
    fireEvent.click(page.getByRole("button", { name: "M" }));
    fireEvent.click(page.getByRole("button", { name: "Red" }));
    expect(page.getByRole("button", { name: "M" }).getAttribute("aria-pressed")).toBe("true");
    expect(page.queryByRole("status")).toBeNull();
    expect(page.getByRole("button", { name: "Add to bag" }).hasAttribute("disabled")).toBe(false);
  });
});
