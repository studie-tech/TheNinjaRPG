import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as pools from "@/hooks/useEffectivePools";
import * as mediaQuery from "@/hooks/useMediaQuery";
import * as avatar from "@/layout/Avatar";
import { BattleFocusView } from "@/layout/BattleFocusView";
import * as profileBox from "@/layout/MenuBoxProfile";
import * as statusBar from "@/layout/StatusBar";
import type { BattleState } from "@/libs/combat/types";
import * as userContext from "@/utils/UserContext";
import { ensureDom } from "../setup/dom.mjs";

ensureDom();

let isDesktop = true;

beforeEach(() => {
  vi.spyOn(mediaQuery, "useMediaQuery").mockImplementation(() => isDesktop);
  vi.spyOn(userContext, "useUserData").mockReturnValue({ timeDiff: 0 } as never);
  vi.spyOn(pools, "useEffectivePools").mockReturnValue({
    curHealth: 10,
    maxHealth: 10,
    curChakra: 10,
    maxChakra: 10,
    curStamina: 10,
    maxStamina: 10,
  });
  vi.spyOn(avatar, "default").mockReturnValue(null as never);
  vi.spyOn(statusBar, "default").mockImplementation(
    ({ title }: { title: string }) => (<span>{title}</span>) as never,
  );
  vi.spyOn(profileBox, "VisualizeEffects").mockReturnValue(null as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
});

const fighter = (userId: string, direction: "left" | "right", extra = {}) => ({
  userId,
  username: userId,
  direction,
  level: 10,
  avatar: null,
  curHealth: 10,
  fledBattle: false,
  leftBattle: false,
  isSummon: false,
  ...extra,
});

const battle = {
  usersState: [
    fighter("me", "left"),
    fighter("ally", "left"),
    fighter("summon", "left", { isSummon: true }),
    fighter("foe", "right"),
    fighter("fled-foe", "right", { fledBattle: true }),
  ],
  usersEffects: [],
} as unknown as BattleState["battle"];

const renderView = (onShowLayout = vi.fn()) =>
  render(
    <BattleFocusView
      battle={battle}
      controlledActorId="me"
      timer={<p>Timer</p>}
      field={<p>Field</p>}
      fieldRatio={0.6}
      dock={<p>Dock</p>}
      autoControl={<p>AI control</p>}
      log={<p>Log body</p>}
      timeline={<p>Timeline body</p>}
      onShowLayout={onShowLayout}
    />,
  );

describe("BattleFocusView", () => {
  it("puts allies beside the player and opponents beside the log, without summons", () => {
    isDesktop = true;
    renderView();
    const own = screen.getByRole("complementary", { name: "Your side" });
    const theirs = screen.getByRole("complementary", { name: "Opponents and battle log" });
    expect(within(own).getByRole("region", { name: "me" })).toBeTruthy();
    expect(within(own).getByRole("region", { name: "ally" })).toBeTruthy();
    expect(within(theirs).getByRole("region", { name: "foe" })).toBeTruthy();
    expect(within(theirs).getByText("Fled")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "summon" })).toBeNull();
    for (const text of ["Timer", "Field", "Dock", "AI control", "Log body"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it("locks page scrolling while shown and restores it after", () => {
    isDesktop = true;
    const view = renderView();
    expect(document.body.style.overflow).toBe("hidden");
    view.unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("shows both fighters and an actions tab on phones", () => {
    isDesktop = false;
    renderView();
    expect(screen.getByRole("region", { name: "me" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "foe" })).toBeTruthy();
    expect(screen.getByText("+1 more")).toBeTruthy();
    expect(screen.getByText("Actions")).toBeTruthy();
  });

  it("hands the screen back to the layout", () => {
    isDesktop = true;
    const onShowLayout = vi.fn();
    renderView(onShowLayout);
    fireEvent.click(screen.getByRole("button", { name: "Show layout" }));
    expect(onShowLayout).toHaveBeenCalledTimes(1);
  });
});
