import { afterEach, expect, it } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { BattleResultSummary } from "@/layout/BattleOutcomeLabel";
import { battleHistoryOutcome } from "@/libs/combat/history";

afterEach(cleanup);

const entry = {
  attackedId: "ann",
  defenderId: "bo",
  attacker: { username: "Ann" },
  defender: { username: "Bo" },
  attackerOutcome: "Won" as const,
  defenderOutcome: "Lost" as const,
};

it("names how the battle ended for each fighter", () => {
  const view = render(<BattleResultSummary entry={entry} />);
  expect(view.container.textContent).toBe("Result:Ann: WonBo: Lost");
});

it("leaves out a fighter without a recorded result", () => {
  const view = render(
    <BattleResultSummary entry={{ ...entry, defenderOutcome: null }} />,
  );
  expect(view.container.textContent).toBe("Result:Ann: Won");
});

it("shows nothing for a battle without recorded results", () => {
  const view = render(
    <BattleResultSummary
      entry={{ ...entry, attackerOutcome: null, defenderOutcome: null }}
    />,
  );
  expect(view.container.textContent).toBe("");
});

it("reads a history row's result from either side", () => {
  expect(battleHistoryOutcome(entry, "ann")).toBe("Won");
  expect(battleHistoryOutcome(entry, "bo")).toBe("Lost");
  expect(battleHistoryOutcome(entry, "someone")).toBeNull();
});
