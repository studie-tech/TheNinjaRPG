import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { createStore, Provider } from "jotai";
import MenuBoxCombat from "@/layout/MenuBoxCombat";
import { maskBattle } from "@/libs/combat/util";
import * as UserContext from "@/utils/UserContext";
import { makeBattleUser, makeCompleteBattle } from "../libs/combat/helpers/battleScenario";

beforeEach(() => {
  vi.spyOn(UserContext, "useUserData").mockReturnValue({
    data: { userId: "viewer" }, timeDiff: 0,
  } as ReturnType<typeof UserContext.useUserData>);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([true, false])("preserves combat identity masking in sidebar profile links (masked: %s)", (isMasked) => {
  const battle = makeCompleteBattle({ usersState: [
    makeBattleUser("viewer"),
    makeBattleUser("opponent", { username: "Mercenary", isAi: false, isMasked }),
  ] });
  const store = createStore();
  store.set(UserContext.userBattleAtom, maskBattle(battle, "viewer"));
  const view = render(<Provider store={store}><MenuBoxCombat /></Provider>);
  expect(view.getAllByText("Mercenary")).toHaveLength(2);
  const profiles = view.queryAllByRole("link", { name: "Mercenary" });
  expect(profiles).toHaveLength(isMasked ? 0 : 2);
  for (const profile of profiles) expect(profile.getAttribute("href")).toBe("/userid/opponent");
});
