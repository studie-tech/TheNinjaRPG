import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import * as image from "@/layout/Image";
import MenuBoxCombat from "@/layout/MenuBoxCombat";
import { maskBattle } from "@/libs/combat/masking";
import * as UserContext from "@/utils/UserContext";
import { makeBattleUser, makeCompleteBattle } from "../setup/combat";
import { actualImage } from "../setup/preload";

beforeEach(() => {
  // Other suites replace the layout Image module; avatars need the real one.
  vi.spyOn(image, "default").mockImplementation(actualImage);
  vi.spyOn(UserContext, "useUserData").mockReturnValue({
    data: { userId: "viewer" },
    timeDiff: 0,
  } as ReturnType<typeof UserContext.useUserData>);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([true, false])(
  "preserves combat identity masking in sidebar profile links (masked: %s)",
  (isMasked) => {
    const battle = makeCompleteBattle({
      usersState: [
        makeBattleUser("viewer", { direction: "left" }),
        makeBattleUser("opponent", { username: "Mercenary", isAi: false, isMasked }),
      ],
    });
    const store = createStore();
    store.set(UserContext.userBattleAtom, maskBattle(battle, "viewer"));
    const view = render(
      <Provider store={store}>
        <MenuBoxCombat />
      </Provider>,
    );
    expect(view.getAllByText("Mercenary")).toHaveLength(2);
    const profiles = view.queryAllByRole("link", { name: "Mercenary" });
    expect(profiles).toHaveLength(isMasked ? 0 : 2);
    for (const profile of profiles)
      expect(profile.getAttribute("href")).toBe("/userid/opponent");
  },
);

it.each([
  { name: "player", isAi: false, isMasked: false, href: "/userid/opponent" },
  { name: "masked player", isAi: false, isMasked: true, href: null },
  { name: "AI", isAi: true, isMasked: false, href: null },
])(
  "links the opponent avatar to the opponent's own profile ($name)",
  ({ isAi, isMasked, href }) => {
    const battle = makeCompleteBattle({
      usersState: [
        makeBattleUser("viewer", { direction: "left" }),
        makeBattleUser("opponent", {
          username: "Mercenary",
          avatar: "/avatar.webp",
          isAi,
          isMasked,
        }),
      ],
    });
    const store = createStore();
    store.set(UserContext.userBattleAtom, maskBattle(battle, "viewer"));
    const view = render(
      <Provider store={store}>
        <MenuBoxCombat />
      </Provider>,
    );
    expect(view.getAllByRole("img", { name: /AvatarImage$/ }).length).toBeGreaterThan(
      0,
    );
    const avatarLink = view
      .queryAllByRole("link")
      .find((link) => link.querySelector("img"));
    expect(avatarLink?.getAttribute("href") ?? null).toBe(href);
    for (const link of view.queryAllByRole("link"))
      expect(link.getAttribute("href")).not.toBe("/profile");
  },
);

it.each([true, false])(
  "preserves profile masking when inspecting a teammate (masked: %s)",
  (isMasked) => {
    const battle = makeCompleteBattle({
      usersState: [
        makeBattleUser("viewer", { direction: "left" }),
        makeBattleUser("ally", {
          direction: "left",
          username: "Teammate",
          avatar: "/ally.webp",
          isAi: false,
          isMasked,
        }),
        makeBattleUser("opponent", {
          username: "Opponent",
          avatar: "/opponent.webp",
          isAi: false,
        }),
      ],
    });
    const store = createStore();
    store.set(UserContext.userBattleAtom, maskBattle(battle, "viewer"));
    const view = render(
      <Provider store={store}>
        <MenuBoxCombat />
      </Provider>,
    );
    expect(view.getAllByRole("link", { name: "Opponent" })).toHaveLength(2);
    fireEvent.change(view.getByRole("combobox", { name: "Inspect character" }), {
      target: { value: "ally" },
    });
    expect(view.queryAllByRole("link", { name: "Opponent" })).toHaveLength(0);
    const profiles = view.queryAllByRole("link", { name: "Teammate" });
    expect(profiles).toHaveLength(isMasked ? 0 : 2);
    for (const profile of profiles)
      expect(profile.getAttribute("href")).toBe("/userid/ally");
    expect(view.getByRole("img", { name: "Teammate AvatarImage" })).toBeTruthy();
  },
);
