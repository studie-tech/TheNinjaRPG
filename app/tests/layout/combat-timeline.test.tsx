import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { getDefaultStore } from "jotai";
import * as client from "@/app/_trpc/client";
import * as contentImage from "@/layout/ContentImage";
import CombatTimeline from "@/layout/CombatTimeline";
import * as itemWithEffects from "@/layout/ItemWithEffects";
import { maskBattle } from "@/libs/combat/masking";
import type { ReturnedBattle } from "@/libs/combat/types";
import { combatPendingActionAtom } from "@/utils/UserContext";
import { makeCompleteBattle, makeUser } from "../setup/combat";
import { stubDialog } from "../setup/dialog";

const spies: { mockRestore: () => void }[] = [];
const query = vi.fn();
let restoreDialogs = () => {};
const entry = (battleVersion: number, appliedEffects: object[]) => ({
  id: `v${battleVersion}`,
  userId: "player",
  actionId: "unknown-action",
  description: `Action <b>${battleVersion}</b>`,
  createdAt: new Date(),
  updatedAt: new Date(),
  battleId: "battle",
  battleVersion,
  battleRound: battleVersion,
  appliedEffects,
});

beforeEach(() => {
  restoreDialogs = stubDialog();
  spies.push(
    vi
      .spyOn(contentImage, "default")
      .mockImplementation((({ alt }: { alt: string }) => <i>{alt}</i>) as never),
  );
  spies.push(
    vi
      .spyOn(itemWithEffects, "default")
      .mockImplementation((({ item }: { item: { name: string } }) => (
        <p>Item {item.name}</p>
      )) as never),
  );
  const api = Object.assign(vi.spyOn(client, "api" as never), {
    combat: {
      getBattleEntries: {
        useQuery: (input: unknown, options: unknown) => {
          query(input, options);
          return {
            data: [
              entry(3, [
                { txt: "Rival burns", color: "orange" },
                { txt: "Rival slows", color: "gray" },
              ]),
              entry(2, []),
            ],
            isFetching: false,
          };
        },
      },
    },
  });
  spies.push(api as never);
});

afterEach(() => {
  cleanup();
  query.mockClear();
  restoreDialogs();
  getDefaultStore().set(combatPendingActionAtom, undefined);
  for (const spy of spies.splice(0)) spy.mockRestore();
});

const battle = () =>
  ({
    ...maskBattle(
      makeCompleteBattle({
        id: "battle",
        version: 8,
        round: 4,
        usersState: [
          makeUser({ userId: "player", username: "Player", avatar: "player.png" }),
        ],
      } as never),
      "player",
    ),
  }) as ReturnedBattle;

it("lists the battle's actions oldest first and opens their applied effects", () => {
  const view = render(<CombatTimeline battle={battle()} showBasicActions={false} />);
  expect(query).toHaveBeenCalledWith(
    {
      battleId: "battle",
      limit: 5,
      offset: 0,
      refreshKey: 8,
      userFilter: "all",
      showBasicActions: false,
    },
    expect.objectContaining({ enabled: true }),
  );
  const slots = view.getAllByRole("button", { name: "View action details" });
  expect(slots.map((slot) => slot.textContent)).toEqual([
    "ActionPlayerRound 2",
    "ActionPlayerRound 3",
  ]);
  expect(
    view.getByRole("button", { name: "Load older actions" }).hasAttribute("disabled"),
  ).toBe(true);

  fireEvent.click(slots[1]!);
  const dialog = view.getByRole("dialog");
  expect(dialog.textContent).toContain("Action details");
  expect(dialog.textContent).toContain("Round 3");
  expect(dialog.textContent).toContain("Action 3");
  expect(dialog.textContent).toContain("Item Unknown action");
  expect(
    Array.from(dialog.querySelectorAll("span.rounded-full")).map((chip) => [
      chip.textContent,
      chip.className,
    ]),
  ).toEqual([
    [
      "Rival burns",
      "rounded-full px-2 py-1 font-medium text-[11px] bg-orange-100 text-orange-500",
    ],
    [
      "Rival slows",
      "rounded-full px-2 py-1 font-medium text-[11px] bg-gray-100 text-gray-500",
    ],
  ]);

  fireEvent.click(slots[0]!);
  expect(view.getByRole("dialog").textContent).not.toContain("Applied effects");
});

it("holds the next slot for the player's pending action", () => {
  getDefaultStore().set(combatPendingActionAtom, {
    battleId: "battle",
    version: 9,
    userId: "player",
    name: "Sonic Slash",
    image: "slash.png",
    cost: 30,
  });
  const view = render(<CombatTimeline battle={battle()} />);
  expect(query).toHaveBeenCalledWith(
    expect.objectContaining({ showBasicActions: true }),
    expect.anything(),
  );
  expect(
    view.getByRole("status", { name: "Performing Sonic Slash" }).textContent,
  ).toContain("Round 4");
});
