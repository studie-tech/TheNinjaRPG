import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import ManualMain from "@/app/[shell]/manual/page";
import * as ContentBox from "@/layout/ContentBox";
import * as ImageLinkGrid from "@/layout/ImageLinkGrid";
import * as UserContext from "@/utils/UserContext";

let hrefs: string[];

beforeEach(() => {
  hrefs = [];
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => <div>{children}</div>);
  vi.spyOn(ImageLinkGrid, "ImageLinkGrid").mockImplementation(({ entries }) => {
    hrefs = entries.map((entry) => entry.href);
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const manualCards = (role: string) => {
  vi.spyOn(UserContext, "useUserData").mockReturnValue({ data: { role } } as never);
  render(<ManualMain />);
  return hrefs;
};

it("lists the dungeon and hunting editors only for content staff", () => {
  expect(manualCards("USER")).not.toContain("/manual/dungeon");
  expect(manualCards("USER")).not.toContain("/manual/hunting");
  expect(manualCards("USER")).toContain("/manual/quest");
  expect(manualCards("CONTENT")).toContain("/manual/dungeon");
  expect(manualCards("CONTENT")).toContain("/manual/hunting");
});
