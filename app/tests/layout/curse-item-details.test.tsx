import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import type { GenericObject } from "@/layout/ItemWithEffects";
import ItemWithEffects from "@/layout/ItemWithEffects";
import * as UserContext from "@/utils/UserContext";
import { CurseTag } from "@/validators/combat";

const names = { useQuery: () => ({ data: [] }) };

beforeEach(() => {
  Object.assign(vi.spyOn(client, "api" as never), {
    bloodline: { getAllNames: names },
    sageMode: { getAllNames: names },
    skillTree: { getAllNames: names },
    item: { getAllNames: names, getEvolutions: names },
    jutsu: { getEvolutions: names },
  });
  vi.spyOn(UserContext, "useUserDataSelector").mockImplementation(
    (select) => ({ data: select({ role: "USER" } as never) }) as never,
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([0, 70])(
  "shows a Curse's %s percent damage bonus separately from its healing power",
  (damageBonusPercent) => {
    const item: GenericObject = {
      id: "curse-jutsu",
      name: "Curse",
      description: "Stores healing.",
      createdAt: new Date(),
      updatedAt: new Date(),
      effects: [CurseTag.parse({ power: 50, damageBonusPercent })],
    };
    const view = render(<ItemWithEffects item={item} hideImage />);
    expect(view.getByText("Damage Bonus:").parentElement?.textContent).toBe(
      `Damage Bonus: ${damageBonusPercent}%`,
    );
    expect(view.getByText("Effect Power:").parentElement?.textContent).toBe(
      "Effect Power: 50",
    );
    expect(
      view.getByText(/Increases the holder's damage by the configured Damage Bonus/),
    ).toBeTruthy();
  },
);
