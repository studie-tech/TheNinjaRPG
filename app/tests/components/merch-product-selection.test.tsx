import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as navigation from "next/navigation";
import * as merchCollection from "@/components/merch/MerchCollection";
import { MerchProductPage } from "@/components/merch/MerchProductPage";
import * as merchProvider from "@/components/merch/MerchProvider";
import * as image from "@/layout/Image";
import * as link from "@/layout/Link";
import { merchProductSchema } from "@/validators/merch";

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

// Spies rather than module mocks, so later suites get the real modules back.
beforeEach(() => {
  vi.spyOn(image, "default").mockImplementation(() => null);
  vi.spyOn(link, "default").mockImplementation(((props: ComponentProps<"a">) => <a {...props} />) as never);
  vi.spyOn(navigation, "useRouter").mockReturnValue({ push: vi.fn() } as never);
  vi.spyOn(merchCollection, "MerchProductCard").mockImplementation((() => null) as never);
  vi.spyOn(merchProvider, "useMerch").mockReturnValue({
    products: [product], loading: false, error: false, retry: vi.fn(),
    preview: false, busy: false, message: "", add: vi.fn(),
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
