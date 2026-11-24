import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import * as client from "@/app/_trpc/client";
import {
  LayoutLeftSidebar,
  LayoutMainMenu,
  LayoutRightSidebarContent,
} from "@/components/layout/shared/LayoutSidebars";
import { DISCORD_INVITE_URL } from "@/drizzle/constants";
import * as Image from "@/layout/Image";
import { GAME_LAYOUTS } from "@/libs/gameLayouts";

const variants = GAME_LAYOUTS.map((layout) => layout.id);
const invalidate = vi.fn(async () => {});

beforeEach(() => {
  invalidate.mockClear();
  // Bun retains module mocks from other suites; this suite needs visible provider icons.
  vi.spyOn(Image, "default").mockImplementation(({ alt, src }) => (
    // biome-ignore lint/performance/noImgElement: isolated sidebar image fixture
    <img alt={alt} src={typeof src === "string" ? src : undefined} />
  ));
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ profile: { getUser: { invalidate: invalidate } } }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("sidebars before character creation", () => {
  it.each(variants)(
    "shows the public community links in the %s left sidebar",
    (variant) => {
      const view = render(
        <LayoutLeftSidebar
          variant={variant}
          isSignedInLayout
          accountState="create-character"
        />,
      );
      expect(view.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe(
        "https://github.com/studie-tech/TheNinjaRPG/issues",
      );
      expect(view.getByRole("link", { name: "Discord" }).getAttribute("href")).toBe(
        DISCORD_INVITE_URL,
      );
      expect(
        view.queryByText("Create your character to unlock the game menus."),
      ).toBeNull();
      expect(view.queryByRole("link", { name: "Create character" })).toBeNull();
    },
  );

  it.each(variants)(
    "shows public navigation without asking a signed-in %s account to sign in again",
    (variant) => {
      const view = render(
        <LayoutRightSidebarContent
          variant={variant}
          isSignedInLayout
          accountState="create-character"
          systems={[]}
          isCombatPage={false}
        />,
      );
      const navigation = within(
        view.getByRole("navigation", { name: "Explore Seichi" }),
      );
      expect(
        navigation.getAllByRole("link").map((link) => link.getAttribute("href")),
      ).toEqual(["/news", "/guide", "/forum", "/manual", "/conceptart"]);
      expect(view.queryByRole("button", { name: "Sign in" })).toBeNull();
      expect(view.queryByRole("link", { name: "Create character" })).toBeNull();
      expect(view.queryByText("Socials Login")).toBeNull();
    },
  );

  it.each(variants)(
    "does not flash character-creation content while a %s account is loading",
    (variant) => {
      const view = render(
        <>
          <LayoutLeftSidebar
            variant={variant}
            isSignedInLayout
            accountState="loading"
          />
          <LayoutRightSidebarContent
            variant={variant}
            isSignedInLayout
            accountState="loading"
            systems={[]}
            isCombatPage={false}
          />
        </>,
      );
      expect(view.queryByRole("link", { name: "Discord" })).toBeNull();
      expect(view.queryByRole("navigation", { name: "Explore Seichi" })).toBeNull();
      expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
    },
  );

  it.each(variants)(
    "shows account-load feedback once, with a retry that reports progress, in %s",
    async (variant) => {
      let finish = () => {};
      invalidate.mockImplementationOnce(
        () => new Promise<void>((resolve) => (finish = resolve)),
      );
      const view = render(
        <>
          <LayoutLeftSidebar variant={variant} isSignedInLayout accountState="error" />
          <LayoutRightSidebarContent
            variant={variant}
            isSignedInLayout
            accountState="error"
            systems={[]}
            isCombatPage={false}
          />
        </>,
      );
      expect(view.getAllByText("We couldn't load your account.")).toHaveLength(1);
      expect(view.queryByRole("navigation", { name: "Explore Seichi" })).toBeNull();
      fireEvent.click(view.getByRole("button", { name: "Try again" }));
      expect(invalidate).toHaveBeenCalledTimes(1);
      const pending = view.getByRole("button", { name: "Trying again…" });
      expect(pending.hasAttribute("disabled")).toBe(true);
      await act(async () => finish());
      expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
    },
  );

  it("offers signed-out Classic visitors account creation beside sign-in", () => {
    const view = render(
      <LayoutRightSidebarContent
        variant="default"
        isSignedInLayout={false}
        accountState={null}
        systems={[]}
        isCombatPage={false}
      />,
    );
    expect(view.getByRole("link", { name: /^Sign in/ }).getAttribute("href")).toBe(
      "/login",
    );
    expect(
      view.getByRole("link", { name: /^Create account/ }).getAttribute("href"),
    ).toBe("/signup");
    expect(view.queryByAltText("DiscordProvider")).toBeNull();
    expect(view.queryByRole("navigation", { name: "Explore Seichi" })).toBeNull();
  });
});

it("uses distinct Sector navigation sections and preserves the location tutorial target", () => {
  const navigate = vi.fn();
  const view = render(
    <>
      <LayoutMainMenu
        variant="sector"
        navbarMenuItems={[{ href: "/news", name: "News" }]}
        signedInIcons={<button type="button">Account controls</button>}
        onNavigate={navigate}
      />
      <LayoutRightSidebarContent
        variant="sector"
        isSignedInLayout
        accountState={null}
        userData={{ userId: "actor", username: "Actor", status: "AWAKE" }}
        systems={[{ href: "/profile", name: "Profile", id: "tutorial-profile" }]}
        location={{
          href: "/village",
          name: "Village",
          id: "tutorial-village",
          icon: <span>Horizon Village</span>,
        }}
        isCombatPage={false}
      />
    </>,
  );
  expect(view.getByText("Community")).toBeTruthy();
  expect(view.getByText("Account")).toBeTruthy();
  expect(view.queryByText("Main Menu")).toBeNull();
  fireEvent.click(view.getByRole("link", { name: "News" }));
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(view.getByRole("link", { name: "Profile" }).id).toBe("tutorial-profile");
  expect(view.getByRole("link", { name: "Horizon Village" }).id).toBe(
    "tutorial-village",
  );
});
