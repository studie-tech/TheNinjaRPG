import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as duty from "@/hooks/useVillageDuty";
import * as Avatar from "@/layout/Avatar";
import * as ContentBox from "@/layout/ContentBox";
import * as Link from "@/layout/Link";
import { VillageDuty } from "@/layout/VillageDuty";

const state = (count: number) => ({
  data: {
    count,
    protectors: Array.from({ length: Math.min(count, 20) }, (_, i) => ({
      userId: `protector-${i}`,
      username: `Protector ${i}`,
      avatar: null,
      defeated: false,
      fighting: false,
    })),
    available: Math.min(count, 20),
    capacity: 20,
    nextCapacity: 20,
    defeated: 0,
    nextRotationAt: new Date(Date.now() + 3600000),
    enrolled: false,
    patrolStatus: "RESERVE",
    canEnroll: true,
  },
  isPending: false,
  isLoading: false,
  isError: false,
  isChanging: false,
  feedback: null as { success: boolean; message: string } | null,
  refetch: vi.fn(),
  setDuty: vi.fn(),
});
let current = state(100);

beforeEach(() => {
  current = state(100);
  vi.spyOn(duty, "useVillageDuty").mockImplementation(() => current as never);
  vi.spyOn(ContentBox, "default").mockImplementation(({ children }) => (
    <div>{children}</div>
  ));
  vi.spyOn(Avatar, "default").mockReturnValue(null);
  vi.spyOn(Link, "default").mockImplementation(({ href, children }) => (
    <a href={String(href)}>{children}</a>
  ));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const panel = () => <VillageDuty villageId="home" navTabs={null} />;

it("explains unavailable duty when the village query is disabled without data", () => {
  vi.spyOn(duty, "useVillageDuty").mockReturnValue({
    ...current,
    data: undefined,
    isPending: true,
    isLoading: false,
  } as never);
  const view = render(<VillageDuty villageId="" navTabs={null} />);
  expect(
    view.getByText("Patrol duty is available to members of a village."),
  ).toBeDefined();
  expect(view.queryByText("Loading village protectors")).toBeNull();
  expect(view.queryByRole("button", { name: "Sign up for duty" })).toBeNull();
});

it("shows the loader while the initial village roster is fetching", () => {
  vi.spyOn(duty, "useVillageDuty").mockReturnValue({
    ...current,
    data: undefined,
    isPending: true,
    isLoading: true,
  } as never);
  const view = render(panel());
  expect(view.getByText("Loading village protectors")).toBeDefined();
  expect(
    view.queryByText("Patrol duty is available to members of a village."),
  ).toBeNull();
  expect(view.queryByRole("button", { name: "Sign up for duty" })).toBeNull();
});

it.each([0, 1, 4, 20, 101])(
  "bounds a roster of %i without losing its count or profile links",
  (count) => {
    current = state(count);
    const view = render(panel());
    expect(view.container.textContent).toContain(`${count} signed up`);
    const links = () => [...view.container.querySelectorAll('a[href^="/userid/"]')];
    expect(links()).toHaveLength(Math.min(count, 4));
    if (count <= 4) {
      expect(
        view.queryByRole("navigation", { name: "Village protector pages" }),
      ).toBeNull();
      if (count === 0) expect(view.getByText(/No one is on duty yet/)).toBeDefined();
      return;
    }
    const previous = view.getByRole("button", { name: "Previous" });
    const next = view.getByRole("button", { name: "Next" });
    expect(previous.hasAttribute("disabled")).toBe(true);
    const seen = new Set<string>();
    for (let page = 0; page < 5; page++) {
      expect(links()).toHaveLength(4);
      for (const link of links()) seen.add(link.getAttribute("href")!);
      if (page < 4) fireEvent.click(next);
    }
    expect(seen.size).toBe(20);
    expect(next.hasAttribute("disabled")).toBe(true);
    expect(links()[3]?.getAttribute("href")).toBe("/userid/protector-19");
    fireEvent.click(previous);
    expect(links()[0]?.getAttribute("href")).toBe("/userid/protector-12");
    expect(view.container.textContent).toContain(
      `${Math.min(count, 20)}/20 patrolling`,
    );
    current = state(1);
    view.rerender(panel());
    expect(links()[0]?.getAttribute("href")).toBe("/userid/protector-0");
  },
);

it.each([true, false])(
  "announces mutation success=%s beside the action on any roster page",
  (success) => {
    const view = render(panel());
    fireEvent.click(view.getByRole("button", { name: "Next" }));
    current.feedback = {
      success,
      message: success ? "You are on duty." : "Return to your home village.",
    };
    view.rerender(panel());
    const feedback = view.getByRole(success ? "status" : "alert");
    const action = view.getByRole("button", { name: "Sign up for duty" });
    const roster = view.getByRole("link", { name: "Protector 4 Patrolling" });
    expect(
      action.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      feedback.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(action);
    expect(current.setDuty).toHaveBeenCalledWith(true);
    current.isChanging = true;
    view.rerender(panel());
    expect(
      view.getByRole("button", { name: "Updating duty..." }).hasAttribute("disabled"),
    ).toBe(true);
  },
);

it.each([
  ["PATROLLING", "Your copy is on patrol"],
  ["FIGHTING", "Your copy is defending"],
  ["DEFEATED", "Your copy is defeated this shift"],
  ["RESERVE", "You are in reserve"],
])("explains enrolled status %s beside Stand down", (status, text) => {
  current.data.enrolled = true;
  current.data.patrolStatus = status!;
  const view = render(panel());
  expect(view.getByText(text!)).toBeDefined();
  expect(view.getByRole("button", { name: "Stand down" })).toBeDefined();
});
