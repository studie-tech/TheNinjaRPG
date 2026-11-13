import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import { BATTLE_LOG_DEFAULT_LIMIT, BATTLE_LOG_FULL_LIMIT } from "@/drizzle/constants";
import CombatHistory from "@/layout/CombatHistory";
import * as elementImage from "@/layout/ElementImage";
import * as parse from "@/utils/parse";
import { mockUserContextValue } from "../setup/userContext";

const spies: { mockRestore: () => void }[] = [];
const entry = (
  battleRound: number,
  battleVersion: number,
  description: string,
  appliedEffects: object[] = [],
) => ({
  id: `${battleRound}-${battleVersion}`,
  userId: "player",
  actionId: "attack",
  description,
  createdAt: new Date(Date.UTC(2026, 0, 1, 12, battleRound, battleVersion)),
  updatedAt: new Date(),
  battleId: "battle",
  battleVersion,
  battleRound,
  appliedEffects,
});
const query = vi.fn();
let historyEntries: ReturnType<typeof entry>[];

beforeEach(() => {
  historyEntries = [
    entry(2, 5, "Player attacks. It is now Rival's turn", [
      {
        txt: "Rival takes 40 Taijutsu damage from Highest Strength and Speed",
        color: "red",
        types: ["Fire", "Water"],
      },
    ]),
    entry(2, 7, "End Turn: Player waits", [
      {
        txt: "Ninjutsu Genjutsu Bukijutsu Intelligence Willpower boost",
        color: "blue",
      },
      { txt: "Unknown shade", color: "black" },
    ]),
    entry(2, 6, "Rival heals. It is now Player's turn", [
      { txt: "Rival heals Taijutsu Taijutsu", color: "green" },
    ]),
    entry(4, 9, "Player flees"),
  ];

  mockUserContextValue({
    data: { userId: "player", role: "USER", showBattleDescription: true },
  });
  spies.push(
    vi
      .spyOn(elementImage, "default")
      .mockImplementation((({ element }: { element: string }) => (
        <i>{element}</i>
      )) as never),
  );
  const api = Object.assign(vi.spyOn(client, "api" as never), {
    combat: {
      getBattleEntries: {
        useQuery: (input: unknown, options: unknown) => {
          query(input, options);
          return {
            data: historyEntries,
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
  for (const spy of spies.splice(0)) spy.mockRestore();
  vi.restoreAllMocks();
});

it("renders rounds newest first, with placeholders, separators and highlighted stat words", () => {
  const view = render(
    <CombatHistory battleId="battle" battleVersion={9} results={null} />,
  );
  expect(query).toHaveBeenCalledWith(
    {
      battleId: "battle",
      refreshKey: 9,
      checkBattle: false,
      limit: expect.any(Number),
    },
    expect.objectContaining({ enabled: true, refetchOnMount: true }),
  );
  const rounds = Array.from(view.container.querySelectorAll("ol > li"));
  expect(
    rounds.map((round) => round.querySelector("button span")?.textContent),
  ).toEqual(["Round 4", "Round 3", "Round 2", "Round 1"]);
  // The two latest rounds open by default; placeholder rounds carry no time.
  expect(
    rounds.map((round) => round.querySelectorAll(":scope > div > div").length),
  ).toEqual([1, 1, 0, 0]);
  expect(rounds[1]?.textContent).toContain(
    "No information on what happened during this round.",
  );
  expect(rounds[1]?.querySelectorAll("button span")).toHaveLength(1);

  fireEvent.click(rounds[2]!.querySelector("button")!);
  const entries = Array.from(rounds[2]!.querySelectorAll(":scope > div > div"));
  expect(entries.map((node) => node.querySelector("p")?.textContent)).toEqual([
    "#7: End Turn: Player waits",
    "#6: Rival heals. It is now Player's turn",
    "#5: Player attacks. It is now Rival's turn",
  ]);
  // A turn change gets a separator, except on the round's latest entry.
  expect(entries.map((node) => !!node.querySelector("hr"))).toEqual([
    false,
    true,
    true,
  ]);
  const effects = entries.flatMap((node) =>
    Array.from(node.querySelectorAll(":scope > div")),
  );
  expect(effects.map((node) => node.className)).toEqual([
    "text-blue-500",
    "text-foreground",
    "text-green-500",
    "text-red-500",
  ]);
  expect(effects.map((node) => node.textContent)).toEqual([
    "- Ninjutsu Genjutsu Bukijutsu Intelligence Willpower boost ",
    "- Unknown shade ",
    "- Rival heals Taijutsu Taijutsu ",
    "- Rival takes 40 Taijutsu damage from Highest Strength and Speed FireWater",
  ]);
  const highlighted = effects.flatMap((node) =>
    Array.from(node.querySelectorAll(":scope > span")).map(
      (span) => `${span.textContent}:${span.className}`,
    ),
  );
  expect(highlighted).toEqual([
    "Ninjutsu:text-blue-600",
    "Genjutsu:text-purple-600",
    "Bukijutsu:text-red-600",
    "Intelligence:text-teal-600",
    "Willpower:text-orange-600",
    "Taijutsu:text-green-600",
    "Taijutsu:text-green-600",
    "Taijutsu:text-green-600",
    "Highest:text-stone-500",
    "Strength:text-blue-800",
    "Speed:text-cyan-600",
  ]);
  expect(
    Array.from(effects[3]!.querySelectorAll("i")).map((node) => node.textContent),
  ).toEqual(["Fire", "Water"]);

  fireEvent.click(rounds[0]!.querySelector("button")!);
  expect(rounds[0]!.querySelectorAll(":scope > div > div")).toHaveLength(0);
});

it("renders a stat word repeated in one effect without duplicate keys", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  spies.push(consoleError);
  const view = render(
    <CombatHistory battleId="battle" battleVersion={9} results={null} />,
  );
  fireEvent.click(view.container.querySelectorAll("ol > li > button")[2]!);
  expect(view.container.textContent).toContain("Rival heals Taijutsu Taijutsu");
  const keyWarnings = consoleError.mock.calls.filter((args) =>
    args.some((arg) => String(arg).includes("same key")),
  );
  expect(keyWarnings).toEqual([]);
});

/** Six actions per round exercise the work done by an ordinary live log update. */
const liveEntries = (rounds: number) =>
  Array.from({ length: rounds * 6 }, (_, index) =>
    entry(Math.floor(index / 6) + 1, index + 1, `Attack ${index}`),
  );

it.each([
  ["USER", "NONE", false, BATTLE_LOG_DEFAULT_LIMIT],
  ["CONTENT-ADMIN", "NONE", false, BATTLE_LOG_FULL_LIMIT],
  ["USER", "GOLD", false, BATTLE_LOG_FULL_LIMIT],
  ["USER", "NONE", true, BATTLE_LOG_FULL_LIMIT],
] as const)(
  "keeps rolling defaults bounded for %s/%s/staff=%s without changing its log limit",
  (role, federalStatus, staffAccount, limit) => {
    mockUserContextValue({
      data: {
        userId: "player",
        role,
        federalStatus,
        staffAccount,
        showBattleDescription: true,
      },
    });
    const parser = vi.spyOn(parse, "parseHtml");
    historyEntries = [];
    const tree = (round: number, version = round * 6) => (
      <CombatHistory battleId="battle" battleRound={round} battleVersion={version} />
    );
    const view = render(tree(0));
    for (let round = 1; round <= 20; round++) {
      historyEntries = liveEntries(round);
      view.rerender(tree(round));
    }
    expect(view.container.querySelectorAll("ol > li > div > div")).toHaveLength(12);
    parser.mockClear();
    view.rerender(tree(20, 121));
    expect(parser).toHaveBeenCalledTimes(12);
    expect(query).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit }),
      expect.anything(),
    );
  },
);

it("retains manual opens and closes across advancing rounds and resets them for another battle", () => {
  historyEntries = liveEntries(4);
  const tree = (round: number, battleId = "battle") => (
    <CombatHistory battleId={battleId} battleRound={round} battleVersion={round * 6} />
  );
  const view = render(tree(4));
  const visibleRounds = () =>
    Array.from(view.container.querySelectorAll("ol > li"))
      .filter((round) => round.querySelector("p"))
      .map((round) => round.querySelector("button span")?.textContent);
  fireEvent.click(view.getByText("Round 1").closest("button")!);
  fireEvent.click(view.getByText("Round 4").closest("button")!);
  expect(visibleRounds()).toEqual(["Round 3", "Round 1"]);
  historyEntries = liveEntries(5);
  view.rerender(tree(5));
  expect(visibleRounds()).toEqual(["Round 5", "Round 1"]);
  historyEntries = liveEntries(6);
  view.rerender(tree(6));
  expect(visibleRounds()).toEqual(["Round 6", "Round 5", "Round 1"]);
  view.rerender(tree(6, "another-battle"));
  expect(visibleRounds()).toEqual(["Round 6", "Round 5"]);
  historyEntries = liveEntries(4);
  view.rerender(tree(4));
  expect(visibleRounds()).toEqual(["Round 4", "Round 3"]);
});
