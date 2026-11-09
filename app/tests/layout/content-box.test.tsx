import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as navigation from "next/navigation";
import ContentBox, * as contentBox from "@/layout/ContentBox";
import { actualContentBox } from "../setup/preload";

beforeEach(() => {
  // Other suites replace ContentBox; this one renders the real component.
  vi.spyOn(contentBox, "default").mockImplementation(actualContentBox);
  vi.spyOn(navigation, "useRouter").mockReturnValue({
    back: vi.fn(),
    push: vi.fn(),
  } as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const headerRow = (stackTopRight?: boolean) => {
  const view = render(
    <ContentBox
      title="Town Hall"
      stackTopRight={stackTopRight}
      topRightContent={<span>Actions</span>}
    >
      Body
    </ContentBox>,
  );
  return view.getByText("Actions").closest("[data-content-box] > div") as HTMLElement;
};

it("stacks the top-right content under the title on phones with stable Tailwind classes", () => {
  expect(headerRow(true).className.split(" ")).toEqual(
    expect.arrayContaining(["flex", "flex-col", "sm:flex-row", "sm:items-center"]),
  );
});

it("keeps the top-right content beside the title by default", () => {
  const classes = headerRow().className.split(" ");
  expect(classes).toEqual(expect.arrayContaining(["flex", "flex-row", "items-center"]));
  expect(classes).not.toContain("flex-col");
});
