import { afterEach, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { CombatNoJutsuNotice } from "@/layout/CombatNoJutsuNotice";
import type { ReturnedBattle } from "@/libs/combat/types";
import { makeBattleUser, makeInjectBattle } from "../setup/combat";

afterEach(() => cleanup());

const equippedJutsu = {
  id: "fireball",
  jutsuId: "fireball",
  equipped: true,
  level: 1,
  experience: 0,
  lastUsedRound: -10,
  originalCooldown: 0,
  origin: "user" as const,
};

const battleFor = (overrides: Parameters<typeof makeBattleUser>[1]) =>
  makeInjectBattle(
    [
      makeBattleUser("player", { isOriginal: true, isAi: false, ...overrides }),
      makeBattleUser("opponent", { isOriginal: true, isAi: true, jutsus: [] }),
    ],
    {},
    { battleType: "COMBAT" },
  ) as unknown as ReturnedBattle;

it("warns a player who entered the battle with no jutsu and links to the Jutsu page", () => {
  const view = render(
    <CombatNoJutsuNotice battle={battleFor({ jutsus: [] })} userId="player" />,
  );
  const status = view.getByRole("status");
  expect(status.textContent).toContain("You have no jutsu equipped.");
  expect(view.getByRole("link", { name: "Jutsu page" }).getAttribute("href")).toBe(
    "/jutsus",
  );
});

it("stays hidden when the player has jutsu equipped", () => {
  const view = render(
    <CombatNoJutsuNotice
      battle={battleFor({ jutsus: [equippedJutsu] })}
      userId="player"
    />,
  );
  expect(view.queryByRole("status")).toBeNull();
});

it("ignores an AI opponent without jutsu", () => {
  const view = render(
    <CombatNoJutsuNotice
      battle={battleFor({ jutsus: [equippedJutsu] })}
      userId="opponent"
    />,
  );
  expect(view.queryByRole("status")).toBeNull();
});
