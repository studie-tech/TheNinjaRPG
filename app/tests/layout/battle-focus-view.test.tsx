import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { useState } from "react";
import * as pools from "@/hooks/useEffectivePools";
import * as mediaQuery from "@/hooks/useMediaQuery";
import * as avatar from "@/layout/Avatar";
import { BattleFocusView } from "@/layout/BattleFocusView";
import * as visualizeEffects from "@/layout/VisualizeEffects";
import * as statusBar from "@/layout/StatusBar";
import type { BattleState } from "@/libs/combat/types";
import * as userContext from "@/utils/UserContext";
import { flushRadixFocus, installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

let isDesktop = true;

beforeEach(() => {
  installBrowserGlobals();
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
  vi.spyOn(visualizeEffects, "VisualizeEffects").mockReturnValue(null as never);
});

afterEach(async () => {
  cleanup();
  await flushRadixFocus();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
  document.body.style.overflow = "";
  restoreBrowserGlobals();
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

const renderView = (
  onShowLayout = vi.fn(),
  overrides: Partial<Parameters<typeof BattleFocusView>[0]> = {},
) =>
  render(
    <BattleFocusView
      battle={battle}
      controlledActorId="me"
      renderTimer={(exitButton) => <div><p>Timer</p>{exitButton}</div>}
      field={<p>Field</p>}
      fieldRatio={0.6}
      dock={<p>Dock</p>}
      autoControl={<p>AI control</p>}
      log={<p>Log body</p>}
      timeline={<p>Timeline body</p>}
      onShowLayout={onShowLayout}
      {...overrides}
    />,
  );

describe("BattleFocusView", () => {
  it("names the battle dialog and dismisses it with Escape", () => {
    const onShowLayout = vi.fn();
    renderView(onShowLayout);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Battle focus" }), { key: "Escape" });
    expect(onShowLayout).toHaveBeenCalledTimes(1);
  });

  it("dismisses from the backdrop without dismissing from chat", async () => {
    const chat = document.createElement("button");
    chat.setAttribute("data-battle-focus-layer", "");
    document.body.append(chat);
    const onShowLayout = vi.fn();
    renderView(onShowLayout);
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.pointerDown(chat, { pointerType: "mouse", button: 0 });
    fireEvent.click(chat);
    expect(onShowLayout).not.toHaveBeenCalled();
    const backdrop = document.querySelector("[data-battle-focus-backdrop]")!;
    fireEvent.pointerDown(backdrop, { pointerType: "mouse", button: 0 });
    fireEvent.click(backdrop);
    await waitFor(() => expect(onShowLayout).toHaveBeenCalledTimes(1));
  });

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

  it("focuses the battle and isolates covered controls without disabling raised siblings", async () => {
    const layout = document.createElement("div");
    layout.innerHTML = '<nav><a href="/village">Village</a></nav><div data-battle-focus-layer><button>Chat</button></div><aside><button>Activity</button></aside><div inert><button>Unavailable</button></div>';
    const iframe = document.createElement("iframe");
    document.body.append(layout, iframe);
    const navigation = layout.querySelector("nav")!;
    const chat = layout.querySelector("[data-battle-focus-layer]")!;
    const activity = layout.querySelector("aside")!;
    const unavailable = layout.querySelector("[inert]")!;
    layout.querySelector("a")!.focus();

    const view = renderView();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Show layout" }));
    expect(navigation.closest("[inert]")).toBeTruthy();
    expect(iframe.hasAttribute("inert")).toBe(true);
    expect(chat.closest("[inert]")).toBeNull();
    expect(activity.closest("[inert]")).toBeTruthy();
    expect(document.body.hasAttribute("inert")).toBe(false);

    // Activity moves above the battlefield only while its tutorial panel is raised.
    activity.setAttribute("data-battle-focus-layer", "");
    await waitFor(() => expect(activity.closest("[inert]")).toBeNull());
    activity.removeAttribute("data-battle-focus-layer");
    await waitFor(() => expect(activity.closest("[inert]")).toBeTruthy());

    // Radix mounts the modal overlay and content as body siblings after opening.
    const overlay = document.createElement("div");
    overlay.setAttribute("data-state", "open");
    const dialog = document.createElement("div");
    dialog.setAttribute("data-state", "open");
    dialog.setAttribute("role", "dialog");
    const popover = document.createElement("div");
    popover.setAttribute("data-radix-popper-content-wrapper", "");
    document.body.append(overlay, dialog, popover);
    await waitFor(() => {
      expect(overlay.closest("[inert]")).toBeNull();
      expect(dialog.closest("[inert]")).toBeNull();
      expect(popover.closest("[inert]")).toBeNull();
    });

    view.unmount();
    expect(navigation.closest("[inert]")).toBeNull();
    expect(iframe.hasAttribute("inert")).toBe(false);
    expect(activity.closest("[inert]")).toBeNull();
    expect(unavailable.hasAttribute("inert")).toBe(true);
  });

  it("shows a controlled summon and its effects alongside its owner", () => {
    isDesktop = true;
    renderView(undefined, { controlledActorId: "summon" });
    const own = screen.getByRole("complementary", { name: "Your side" });
    expect(within(own).getByRole("region", { name: "summon" })).toBeTruthy();
    expect(within(own).getByRole("region", { name: "me" })).toBeTruthy();
    expect(visualizeEffects.VisualizeEffects).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "summon" }),
      undefined,
    );
  });

  it("swaps desktop actions and history while keeping the field mounted", () => {
    isDesktop = true;
    let mounts = 0;
    const Field = () => {
      const [id] = useState(() => ++mounts);
      return <p>Field {id}</p>;
    };
    const props = { field: <Field /> };
    const view = renderView(undefined, props);
    const main = screen.getByRole("main", { name: "Battle" });
    const side = screen.getByRole("complementary", { name: "Opponents and battle log" });
    expect(within(main).getByText("Dock")).toBeTruthy();
    expect(within(side).getByText("Log body")).toBeTruthy();
    view.rerender(
      <BattleFocusView
        battle={battle}
        controlledActorId="me"
        renderTimer={(exitButton) => <div><p>Timer</p>{exitButton}</div>}
        field={props.field}
        fieldRatio={0.6}
        dock={<p>Dock</p>}
        log={<p>Log body</p>}
        timeline={<p>Timeline body</p>}
        onShowLayout={vi.fn()}
        swapFocusPanels
      />,
    );
    const swappedSide = screen.getByRole("complementary", { name: "Opponents and actions" });
    expect(within(main).getByRole("region", { name: "Battle history" })).toBeTruthy();
    expect(within(main).getByText("Log body")).toBeTruthy();
    expect(within(swappedSide).getByRole("region", { name: "Battle actions" })).toBeTruthy();
    expect(within(swappedSide).getByText("Dock")).toBeTruthy();
    expect(screen.getByText("Field 1")).toBeTruthy();
    expect(mounts).toBe(1);
  });

  it("shows both fighters and an actions tab on phones", () => {
    isDesktop = false;
    renderView();
    expect(screen.getByRole("region", { name: "me" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "foe" })).toBeTruthy();
    expect(screen.getByText("+1 more")).toBeTruthy();
    expect(screen.getByText("Actions")).toBeTruthy();
  });

  it("keeps phone tabs and the controlled summon when desktop swapping is saved", () => {
    isDesktop = false;
    renderView(undefined, { controlledActorId: "summon", swapFocusPanels: true });
    expect(screen.getByRole("region", { name: "summon" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "foe" })).toBeTruthy();
    expect(within(screen.getByRole("tabpanel")).getByText("Dock")).toBeTruthy();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("names each fighter's bloodline and keystone, on desktop and on phones", () => {
    const withTraits = {
      ...battle,
      usersState: battle!.usersState.map((user) =>
        user.userId === "foe"
          ? { ...user, bloodlineId: "bl", keystoneItemId: "ks", keystoneName: "Jade Keystone" }
          : user,
      ),
      extraState: {
        bloodlines: { bl: { id: "bl", name: "Musashi Ken", effects: [] } },
        keystoneItems: { ks: { id: "ks", name: "Jade Keystone", effects: [] } },
      },
    } as unknown as BattleState["battle"];
    for (const desktop of [true, false]) {
      isDesktop = desktop;
      renderView(vi.fn(), { battle: withTraits });
      const foe = screen.getByRole("region", { name: "foe" });
      expect(within(foe).getByText("Musashi Ken")).toBeTruthy();
      expect(within(foe).getByText("Jade Keystone")).toBeTruthy();
      cleanup();
    }
  });

  it("sizes the desktop field box to the field so the actions sit right under it", () => {
    isDesktop = true;
    renderView();
    const fieldBox = screen.getByText("Field").parentElement!.parentElement!;
    // 100cqw × the 0.6 field ratio
    expect(fieldBox.style.flexBasis).toBe("calc(60cqw)");
    expect(fieldBox.className).not.toContain("flex-1");
    expect(fieldBox.parentElement!.className).toContain("[container-type:inline-size]");
  });

  it("hands the screen back to the layout", () => {
    isDesktop = true;
    const onShowLayout = vi.fn();
    renderView(onShowLayout);
    fireEvent.click(screen.getByRole("button", { name: "Show layout" }));
    expect(onShowLayout).toHaveBeenCalledTimes(1);
  });
});
