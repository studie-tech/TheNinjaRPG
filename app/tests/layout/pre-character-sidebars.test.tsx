import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as client from "@/app/_trpc/client";
import {
  LayoutLeftSidebar,
  LayoutRightSidebarContent,
} from "@/components/layout/shared/LayoutSidebars";
import { GAME_LAYOUTS } from "@/libs/gameLayouts";
import { DISCORD_INVITE_URL } from "@/drizzle/constants";
import * as Image from "@/layout/Image";
import { ensureDom } from "../setup/dom.mjs";

const variants = GAME_LAYOUTS.map((layout) => layout.id);
const invalidate = vi.fn(async () => {});

beforeEach(() => {
  ensureDom();
  invalidate.mockClear();
  // Bun retains module mocks from other suites; this suite needs visible provider icons.
  vi.spyOn(Image, "default").mockImplementation(({ alt, src }) => (
    // biome-ignore lint/performance/noImgElement: isolated sidebar image fixture
    <img alt={alt} src={typeof src === "string" ? src : undefined} />
  ));
  Object.assign(vi.spyOn(client, "api" as never), {
    useUtils: () => ({ profile: { getUser: { refetch: invalidate } } }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("sidebars before character creation", () => {
  it.each(variants)("shows the public community links in the %s left sidebar", (variant) => {
    const view = render(<LayoutLeftSidebar variant={variant} isSignedInLayout accountState="create-character" />);
    expect(view.getByRole("link", { name: "GitHub" }).getAttribute("href")).toBe("https://github.com/studie-tech/TheNinjaRPG/issues");
    expect(view.getByRole("link", { name: "Discord" }).getAttribute("href")).toBe(DISCORD_INVITE_URL);
    expect(view.queryByText("Create your character to unlock the game menus.")).toBeNull();
    expect(view.queryByRole("link", { name: "Create character" })).toBeNull();
  });

  it.each(variants)("shows public navigation without asking a signed-in %s account to sign in again", (variant) => {
    const view = render(<LayoutRightSidebarContent variant={variant} isSignedInLayout accountState="create-character" systems={[]} />);
    const navigation = within(view.getByRole("navigation", { name: "Explore Seichi" }));
    expect(navigation.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/news", "/guide", "/forum", "/manual", "/conceptart",
    ]);
    expect(view.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(view.queryByRole("link", { name: "Create character" })).toBeNull();
    expect(view.queryByText("Socials Login")).toBeNull();
  });

  it.each(variants)("does not flash character-creation content while a %s account is loading", (variant) => {
    const view = render(<>
      <LayoutLeftSidebar variant={variant} isSignedInLayout accountState="loading" />
      <LayoutRightSidebarContent variant={variant} isSignedInLayout accountState="loading" systems={[]} />
    </>);
    expect(view.queryByRole("link", { name: "Discord" })).toBeNull();
    expect(view.queryByRole("navigation", { name: "Explore Seichi" })).toBeNull();
    expect(view.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it.each(variants)("retains account-load feedback and retry in %s", (variant) => {
    const view = render(<LayoutRightSidebarContent variant={variant} isSignedInLayout accountState="error" systems={[]} />);
    expect(view.getByText("We couldn't load your account.")).toBeTruthy();
    expect(view.queryByRole("navigation", { name: "Explore Seichi" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing sign-in panel for signed-out Classic visitors", () => {
    const view = render(<LayoutRightSidebarContent variant="default" isSignedInLayout={false} accountState={null} systems={[]} />);
    expect(view.getByRole("link", { name: /^Sign in/ }).getAttribute("href")).toBe("/login");
    expect(view.getByAltText("DiscordProvider")).toBeTruthy();
    expect(view.queryByRole("navigation", { name: "Explore Seichi" })).toBeNull();
  });
});
