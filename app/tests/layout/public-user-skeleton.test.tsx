import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as ContentBox from "@/layout/ContentBox";
import * as Image from "@/layout/Image";
import { PublicUserSkeleton } from "@/layout/publicUser/PublicUserSkeleton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows a guest one box titled with the player, with the intro inside it", () => {
  const boxes = vi
    .spyOn(ContentBox, "default")
    .mockImplementation(({ title, subtitle, children }) => (
      <section>
        <h1>{title}</h1>
        <p>{subtitle}</p>
        {children}
      </section>
    ));
  vi.spyOn(Image, "default").mockImplementation((() => null) as never);
  const view = render(
    <PublicUserSkeleton
      title="TestNin"
      subtitle="Lvl. 12 Genin"
      isGuest
      seed={{
        username: "TestNin",
        level: 12,
        rank: "GENIN",
        isOutlaw: false,
        avatar: null,
      }}
    />,
  );
  expect(boxes).toHaveBeenCalledTimes(1);
  expect(view.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
    "TestNin",
  ]);
  expect(view.container.querySelector("section > p")?.textContent).toBe(
    "Lvl. 12 Genin",
  );
  expect(view.getByText("Create a free account")).toBeTruthy();
});
