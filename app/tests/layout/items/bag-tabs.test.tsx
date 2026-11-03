import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { BagCapacity, BagTabs } from "@/layout/items/BagTabs";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.localStorage.clear();
});

const bags = [
  { value: "all", count: 58 },
  { value: "normal", count: 16 },
  { value: "event", count: 2 },
  { value: "materials", count: 31 },
  { value: "cooking", count: 9 },
];

it("names each bag with its item count and marks the open one", () => {
  render(<BagTabs bags={bags} active="normal" onChange={vi.fn()} />);
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["All · 58", "Gear · 16", "Event · 2", "Materials · 31", "Cooking · 9"]);
  expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
  expect(tabs[0]?.getAttribute("aria-selected")).toBe("false");
});

it("switches bags and remembers the choice", () => {
  const onChange = vi.fn();
  render(<BagTabs bags={bags} active="normal" onChange={onChange} />);
  fireEvent.click(screen.getByRole("tab", { name: "Materials · 31" }));
  expect(onChange).toHaveBeenCalledWith("materials");
  expect(window.localStorage.getItem("backpackSelection")).toBe("materials");
});

it("reopens the remembered bag after mount", () => {
  window.localStorage.setItem("backpackSelection", "cooking");
  const onChange = vi.fn();
  act(() => {
    render(<BagTabs bags={bags} active="normal" onChange={onChange} />);
  });
  expect(onChange).toHaveBeenCalledWith("cooking");
});

it("shows the bag's used and total slots", () => {
  render(<BagCapacity used={4} max={20} />);
  const capacity = screen.getByText("4 of 20 bag slots used").parentElement!;
  expect(screen.getByText("4 / 20").getAttribute("aria-hidden")).toBe("true");
  expect(capacity.getAttribute("data-over")).toBeNull();
});

it("explains a bag over its limit", () => {
  render(<BagCapacity used={37} max={20} />);
  const capacity = screen.getByText("37 of 20 bag slots used, 17 over the limit").parentElement!;
  expect(capacity.getAttribute("data-over")).toBe("true");
  expect(capacity.getAttribute("title")).toBe(
    "Rewards and drops can go past the limit. Until you are back under it, you cannot buy items or take them out of your home.",
  );
});

it("marks a bag over its limit in its tab", () => {
  render(
    <BagTabs
      bags={[
        { value: "all", count: 40 },
        { value: "normal", count: 37, over: true },
      ]}
      active="all"
      onChange={vi.fn()}
    />,
  );
  const gear = screen.getByRole("tab", { name: /^Gear · 37/ });
  expect(gear.getAttribute("data-over")).toBe("true");
  expect(gear.textContent).toBe("Gear · 37 (over limit)");
  expect(screen.getByRole("tab", { name: "All · 40" }).getAttribute("data-over")).toBeNull();
});
