import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { DungeonHallOfFame } from "@/layout/DungeonHallOfFame";
import * as modal from "@/layout/Modal";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens both squad rankings in modals with grouped member names", () => {
  const inputs: { mode: string; page: number }[] = [];
  Object.assign(vi.spyOn(client, "api" as never), {
    coop: {
      dungeon: {
        getHallOfFameDungeons: {
          useQuery: () => ({
            data: [{ id: "d", name: "Dungeon" }],
            isPending: false,
            isError: false,
          }),
        },
        getRankings: {
          useQuery: (input: { mode: string; page: number }) => {
            inputs.push(input);
            return {
              isPending: false,
              isError: false,
              isFetching: false,
              data: {
                hasMore: true,
                entries: [
                  {
                    id: "run",
                    rank: 1,
                    durationMs: 65000,
                    completedAt: 100000,
                    players: [
                      { id: "a", name: "Akira" },
                      { id: "b", name: "ShadowFox" },
                      { id: "c", name: "Kuren" },
                    ],
                  },
                ],
              },
            };
          },
        },
      },
    },
  });
  vi.spyOn(modal, "default").mockImplementation(({ title, children, setIsOpen }) => (
    <section role="dialog" aria-label={title}>
      {children}
      <button type="button" onClick={() => setIsOpen(false)}>
        Close
      </button>
    </section>
  ));
  const view = render(<DungeonHallOfFame />);
  expect(view.queryByRole("dialog")).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Fastest Clear for Dungeon" }));
  let dialog = within(view.getByRole("dialog", { name: "Dungeon · Fastest Clear" }));
  const squad = within(dialog.getByRole("list", { name: "Squad members" }));
  expect(squad.getByText("Akira")).toBeTruthy();
  expect(squad.getByText("ShadowFox")).toBeTruthy();
  expect(squad.getByText("Kuren")).toBeTruthy();
  expect(dialog.getByText("1m 5s")).toBeTruthy();
  fireEvent.click(dialog.getByRole("button", { name: "Next" }));
  expect(inputs.at(-1)).toMatchObject({ mode: "fastest", page: 1 });
  fireEvent.click(view.getByRole("button", { name: "Close" }));
  fireEvent.click(view.getByRole("button", { name: "Completed for Dungeon" }));
  dialog = within(view.getByRole("dialog", { name: "Dungeon · Completed" }));
  expect(dialog.getByText("Completion #1")).toBeTruthy();
  expect(inputs.at(-1)).toMatchObject({ mode: "completed", page: 0 });
});
