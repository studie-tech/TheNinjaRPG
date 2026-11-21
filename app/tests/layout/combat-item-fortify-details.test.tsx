import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import type { Item } from "@/drizzle/schema";
import ItemWithEffects from "@/layout/ItemWithEffects";
import { userItemToAction } from "@/libs/combat/actions";
import type { CombatAction } from "@/libs/combat/types";
import { FinalStandTag } from "@/validators/combat";
import { makeBattleUserItem, makeBattleWithWeapon, makeUser } from "../setup/combat";
import { mockUserContextValue } from "../setup/userContext";

const names = { useQuery: () => ({ data: [] }) };

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    bloodline: { getAllNames: names },
    sageMode: { getAllNames: names },
    skillTree: { getAllNames: names },
    item: { getAllNames: names, getEvolutions: names },
    jutsu: { getEvolutions: names },
  });
  mockUserContextValue({ data: { role: "USER" } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([0, 1, 5])(
  "shows a weapon's effective power in its combat preview at Fortify +%s",
  (level) => {
    const effect = FinalStandTag.parse({
      power: 100,
      fortifyId: "finalstand",
      fortifyEnabled: true,
    });
    const battle = makeBattleWithWeapon({ item: { effects: [effect] } });
    const owned = makeBattleUserItem({
      fortification: level
        ? { finalstand: { type: "finalstand", level, failures: 0 } }
        : undefined,
    });
    const action: CombatAction = userItemToAction(owned, makeUser(), battle);
    const view = render(<ItemWithEffects item={action as unknown as Item} hideImage />);

    expect(view.container.textContent).not.toContain("PLEASE REPORT!");
    expect(view.getByText("Effect Power:").parentElement?.textContent).toBe(
      `Effect Power: ${100 + level}`,
    );
    if (level) {
      expect(view.getByText(`finalstand: Fortify +${level}`)).toBeTruthy();
    } else {
      expect(view.queryByText("Fortification")).toBeNull();
    }
    expect(action.effects[0]?.power).toBe(100 + level);
    expect(effect.power).toBe(100);
  },
);
