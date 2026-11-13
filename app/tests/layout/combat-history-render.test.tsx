import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import CombatHistory from "@/layout/CombatHistory";
import * as elementImage from "@/layout/ElementImage";
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

beforeEach(() => {
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
            data: [
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
