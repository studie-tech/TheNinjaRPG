import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { Settings, Shield, UserRound } from "lucide-react";
import * as navigation from "next/navigation";
import { useSyncExternalStore } from "react";
import * as Link from "@/layout/Link";
import { ProfileSettingsNavigation, type ProfileSettingsGroup } from "@/layout/ProfileSettingsNavigation";
import { ensureDom } from "../setup/dom.mjs";

const mounted = vi.fn();
/** Record rendered editors so navigation tests catch hidden forms mounting eagerly. */
function Editor({ name }: { name: string }) {
  mounted(name);
  return <label>{name} draft<input aria-label={`${name} draft`} /></label>;
}
const groups: ProfileSettingsGroup[] = [
  {
    id: "appearance", title: "Profile & appearance", description: "Your public character", icon: UserRound,
    settings: [
      { id: "avatar", title: "Avatar", description: "Generate or upload an image", keywords: "previous custom photo", icon: UserRound, content: <Editor name="Avatar" /> },
      { id: "name", title: "Name change", description: "Change your username", icon: UserRound, notice: "Costs reputation points", content: <Editor name="Name" /> },
    ],
  },
  {
    id: "display", title: "Display & navigation", description: "Reading preferences and shortcuts", icon: Settings,
    settings: [{ id: "reading", title: "Reading", description: "Text size and fonts", icon: Settings, content: <Editor name="Reading" /> }],
  },
];

const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
};

beforeEach(() => {
  ensureDom();
  window.history.replaceState(null, "", "/profile?tab=edit&petId=companion");
  mounted.mockClear();
  vi.spyOn(navigation, "useSearchParams").mockImplementation(() => {
    const search = useSyncExternalStore(subscribe, () => window.location.search);
    return new URLSearchParams(search) as ReturnType<typeof navigation.useSearchParams>;
  });
  const pushState = window.history.pushState.bind(window.history);
  // Notify the search-param double as Next does for its integrated history updates.
  vi.spyOn(window.history, "pushState").mockImplementation((...args) => {
    pushState(...args);
    window.dispatchEvent(new window.PopStateEvent("popstate"));
  });
  vi.spyOn(Link, "default").mockImplementation(({ href, children, onNavigate, prefetch: _prefetch, ...props }) => (
    <a {...props} href={String(href)} onClick={(event) => {
      event.preventDefault();
      onNavigate?.({ preventDefault() {} });
    }}>{children}</a>
  ));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mount = (visibleGroups = groups) => render(<ProfileSettingsNavigation groups={visibleGroups} summary={<p>Player settings</p>} />);

it("starts with categories and mounts only the selected editor", () => {
  const view = mount();
  expect(mounted).not.toHaveBeenCalled();
  expect(view.queryByRole("textbox", { name: "Name draft" })).toBeNull();
  fireEvent.click(view.getByRole("link", { name: /Profile & appearance/ }));
  expect(mounted).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("link", { name: /Name change/ }));
  expect(view.getByText("Costs reputation points")).toBeTruthy();
  expect(view.getByRole("textbox", { name: "Name draft" })).toBeTruthy();
  expect(mounted.mock.calls.every(([name]) => name === "Name")).toBe(true);
  expect(new URLSearchParams(window.location.search).get("petId")).toBe("companion");
  expect(new URLSearchParams(window.location.search).get("setting")).toBe("name");
  expect(document.activeElement).toBe(view.getByRole("heading", { name: "Name change" }));
});

it("restores a bookmarked editor and returns to its category", () => {
  window.history.replaceState(null, "", "/profile?tab=edit&settings=appearance&setting=name");
  const view = mount();
  expect(view.getByRole("textbox", { name: "Name draft" })).toBeTruthy();
  const editor = view.getByRole("region", { name: "Name change" });
  fireEvent.click(within(editor).getByRole("link", { name: "Profile & appearance" }));
  expect(view.queryByRole("textbox", { name: "Name draft" })).toBeNull();
  expect(view.getByRole("navigation", { name: "Profile & appearance" })).toBeTruthy();
});

it("supports browser back and forward between editors and categories", async () => {
  const view = mount();
  fireEvent.click(view.getByRole("link", { name: /Profile & appearance/ }));
  fireEvent.click(view.getByRole("link", { name: /Name change/ }));
  act(() => window.history.back());
  await waitFor(() => expect(view.queryByRole("textbox", { name: "Name draft" })).toBeNull());
  expect(view.getByRole("navigation", { name: "Profile & appearance" })).toBeTruthy();
  act(() => window.history.forward());
  await waitFor(() => expect(view.getByRole("textbox", { name: "Name draft" })).toBeTruthy());
});

it("finds settings by keywords and returns from the editor to search results", () => {
  const view = mount();
  fireEvent.change(view.getByRole("searchbox", { name: "Search settings" }), { target: { value: "  PHOTO  " } });
  expect(view.getByRole("status").textContent).toBe("1 setting found");
  expect(view.queryByRole("link", { name: /Name change/ })).toBeNull();
  fireEvent.click(view.getByRole("link", { name: /Avatar/ }));
  expect(view.getByRole("textbox", { name: "Avatar draft" })).toBeTruthy();
  fireEvent.click(view.getByRole("link", { name: "Search results" }));
  expect(view.getByRole("searchbox").getAttribute("value")).toBe("  PHOTO  ");
  expect(view.getByRole("status").textContent).toBe("1 setting found");
});

it("offers a recovery action when a search has no results", () => {
  const view = mount();
  fireEvent.change(view.getByRole("searchbox"), { target: { value: "does not exist" } });
  expect(view.getByRole("status").textContent).toBe("0 settings found");
  fireEvent.click(view.getByRole("button", { name: "Show all settings" }));
  expect(view.getByRole("navigation", { name: "Settings categories" })).toBeTruthy();
});

it("opens single-setting categories directly and returns to the overview", () => {
  const view = mount();
  fireEvent.click(view.getByRole("link", { name: /Display & navigation/ }));
  expect(view.getByRole("textbox", { name: "Reading draft" })).toBeTruthy();
  const editor = view.getByRole("region", { name: "Reading" });
  fireEvent.click(within(editor).getByRole("link", { name: "All settings" }));
  expect(view.getByRole("searchbox")).toBeTruthy();
});

it("matches multiple search terms across names and keywords", () => {
  const view = mount();
  fireEvent.change(view.getByRole("searchbox"), { target: { value: "custom avatar" } });
  expect(view.getByRole("status").textContent).toBe("1 setting found");
  expect(view.getByRole("link", { name: /Avatar/ })).toBeTruthy();
});

it("recovers from unknown or no-longer-permitted destinations without mounting them", () => {
  window.history.replaceState(null, "", "/profile?tab=edit&settings=staff&setting=management");
  const staffGroup: ProfileSettingsGroup = {
    id: "staff", title: "Staff tools", description: "Management", icon: Shield,
    settings: [{ id: "management", title: "Management commands", description: "Manage game", icon: Shield, content: <Editor name="Staff" /> }],
  };
  const view = mount([...groups, staffGroup]);
  expect(view.getByRole("textbox", { name: "Staff draft" })).toBeTruthy();
  mounted.mockClear();
  view.rerender(<ProfileSettingsNavigation groups={groups} summary={<p>Player settings</p>} />);
  expect(view.queryByRole("textbox", { name: "Staff draft" })).toBeNull();
  expect(view.getByRole("navigation", { name: "Settings categories" })).toBeTruthy();
  expect(mounted).not.toHaveBeenCalled();
  fireEvent.change(view.getByRole("searchbox"), { target: { value: "management" } });
  expect(view.getByRole("status").textContent).toBe("0 settings found");
});

it("falls back to a known category when a setting link is stale", () => {
  window.history.replaceState(null, "", "/profile?tab=edit&settings=appearance&setting=unknown");
  const view = mount();
  expect(view.getByRole("navigation", { name: "Profile & appearance" })).toBeTruthy();
  expect(mounted).not.toHaveBeenCalled();
});
