import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import * as contentBox from "@/layout/ContentBox";
import { DungeonCatalogue } from "@/layout/DungeonCatalogue";
import * as modal from "@/layout/Modal";
import * as userContext from "@/utils/UserContext";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens reward chances in a modal and paginates the dungeon list", () => {
  vi.spyOn(userContext, "useUserData").mockReturnValue({ timeDiff: 0 } as never);
  vi.spyOn(contentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(modal, "default").mockImplementation(({ title, children, setIsOpen }) => (
    <section role="dialog" aria-label={title}>
      {children}
      <button type="button" onClick={() => setIsOpen(false)}>
        Close
      </button>
    </section>
  ));
  const data = Array.from({ length: 11 }, (_, index) => ({
    id: String(index),
    name: `Dungeon ${index + 1}`,
    sector: 301,
    longitude: 12,
    latitude: 7,
    expiresAt: null,
    description: "Explore the ruins.",
    requiredLevel: 10,
    rewards: {
      money: 100,
      experience: 10,
      tokens: 5,
      prestige: 2,
      drops: [
        {
          id: "reward",
          name: "Reward scroll",
          type: "jutsu",
          quantity: 1,
          chance: 15,
          onlyOnce: true,
        },
      ],
    },
  }));
  Object.assign(vi.spyOn(client, "api" as never), {
    coop: {
      dungeon: {
        getCatalogue: {
          useQuery: () => ({
            data,
            refetch: vi.fn(),
            isPending: false,
            isError: false,
          }),
        },
      },
    },
  });
  const view = render(<DungeonCatalogue />);
  expect(view.queryByRole("dialog")).toBeNull();
  expect(view.queryByText("Dungeon 11")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Details for Dungeon 1" }));
  expect(view.getByRole("dialog", { name: "Dungeon 1" })).toBeTruthy();
  expect(view.getByText("Reward scroll")).toBeTruthy();
  expect(view.getByText("15%")).toBeTruthy();
  expect(view.getByText("Once per player per dungeon")).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Close" }));
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Next" }));
  expect(view.getByText("Dungeon 11")).toBeTruthy();
  expect(view.queryByText("Dungeon 1")).toBeNull();
  expect(view.getByRole("tab", { name: "Hall of Fame" })).toBeTruthy();
});
