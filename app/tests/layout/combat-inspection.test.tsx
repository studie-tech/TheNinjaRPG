import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { useCombatInspection } from "@/hooks/useCombatInspection";
import { CombatInspectionPicker } from "@/layout/CombatInspectionPicker";
import type { CombatInspection } from "@/libs/combat/inspection";
import { resolveCombatInspection } from "@/libs/combat/inspection";
import type { ReturnedBattle } from "@/libs/combat/types";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";
import { readSource, runInScope, sliceExpressionAfter } from "../setup/sourceSlice";

beforeEach(installBrowserGlobals);
afterEach(() => {
  cleanup();
  restoreBrowserGlobals();
});

const battle = (id = "battle", health = 70) =>
  ({
    id,
    usersState: [
      { userId: "me", username: "Player", direction: "left", curHealth: 100 },
      { userId: "ally", username: "Twin", direction: "left", curHealth: health },
      { userId: "enemy", username: "Twin", direction: "right", curHealth: 90 },
    ],
  }) as ReturnedBattle;

function Panel({ shown }: { shown: ReturnedBattle }) {
  const { selectedUser } = useCombatInspection(shown, "me");
  return (
    <output data-testid="inspected">
      {selectedUser?.userId}:{selectedUser?.curHealth}
    </output>
  );
}

function Layout({
  shown,
  alternate = false,
}: {
  shown: ReturnedBattle;
  alternate?: boolean;
}) {
  return (
    <>
      <CombatInspectionPicker battle={shown} viewerId="me" />
      <Panel key={String(alternate)} shown={shown} />
    </>
  );
}

it("shares selection, distinguishes duplicate names and preserves it through updates and panel remounts", () => {
  const view = render(<Layout shown={battle()} />, { wrapper: Provider });
  const picker = screen.getByRole("combobox", { name: "Inspect character" });
  fireEvent.change(picker, { target: { value: "ally" } });
  expect(screen.getByTestId("inspected").textContent).toBe("ally:70");
  view.rerender(<Layout shown={battle("battle", 25)} alternate />);
  expect(screen.getByTestId("inspected").textContent).toBe("ally:25");
  fireEvent.change(picker, { target: { value: "" } });
  expect(screen.getByTestId("inspected").textContent).toBe("enemy:90");
});

it("clears selection when the displayed roster removes a character and when a new battle starts", () => {
  const view = render(<Layout shown={battle()} />, { wrapper: Provider });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "ally" } });
  const next = battle();
  next.usersState = next.usersState.filter((user) => user.userId !== "ally");
  view.rerender(<Layout shown={next} />);
  expect(screen.getByTestId("inspected").textContent).toBe("enemy:90");
  view.rerender(<Layout shown={battle()} />);
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "ally" } });
  view.rerender(<Layout shown={battle("next")} />);
  expect(screen.getByTestId("inspected").textContent).toBe("enemy:90");
});

it.each([
  { initialId: null, clickedId: "me", expectedId: "enemy" },
  { initialId: "ally", clickedId: "me", expectedId: "ally" },
  { initialId: null, clickedId: "ally", expectedId: "ally" },
  { initialId: "ally", clickedId: "enemy", expectedId: "enemy" },
])(
  "inspects $expectedId after tapping $clickedId with selection $initialId while submitting the action",
  ({ initialId, clickedId, expectedId }) => {
    const shown = battle();
    let selection: CombatInspection = initialId
      ? { battleId: shown.id, userId: initialId }
      : null;
    const target = { col: 2, row: 3 };
    const performAction = mock();
    const validateActionTarget = mock(() => ({ isValid: true }));
    const onTap = sliceExpressionAfter(
      readSource("layout/Combat.tsx"),
      /combatCallbacks\.current\.onTap = \(target, character\) =>\s*/,
    );
    const cursor = document.body.style.cursor;
    document.body.style.cursor = "";
    try {
      runInScope(onTap, {
        target,
        character: { userId: clickedId },
        controlledActorId: "me",
        touchDetailsOpenRef: { current: false },
        suppressClickUntilRef: { current: 0 },
        resultRef: { current: null },
        inspectUser: (userId: string) => {
          selection = { battleId: shown.id, userId };
        },
        setAggroTarget() {},
        config: { showAggro: false },
        battleRef: { current: shown },
        actionRef: { current: { id: "ability" } },
        gridRef: { current: {} },
        userIdRef: { current: "me" },
        timeDiff: 0,
        precomputedActionsRef: { current: [] },
        validateActionTarget,
        canPerformAction: () => true,
        performAction,
      });
      expect(resolveCombatInspection(shown, "me", selection)?.userId).toBe(expectedId);
      expect(validateActionTarget).toHaveBeenCalledWith(
        expect.objectContaining({ user: shown.usersState[0], target }),
      );
      expect(performAction).toHaveBeenCalledTimes(1);
      expect(performAction).toHaveBeenCalledWith({
        battleId: shown.id,
        version: shown.version,
        actionId: "ability",
        longitude: target.col,
        latitude: target.row,
      });
    } finally {
      document.body.style.cursor = cursor;
    }
  },
);
