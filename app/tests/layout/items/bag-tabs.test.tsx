import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { BagTabs } from "@/layout/items/BagTabs";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.localStorage.clear();
});

const bags = [
  { value: "normal", count: 16 },
  { value: "event", count: 2 },
  { value: "materials", count: 31 },
  { value: "cooking", count: 9 },
];

it("names each bag with its item count and marks the open one", () => {
  render(<BagTabs bags={bags} active="normal" onChange={vi.fn()} />);
  const tabs = screen.getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual(["Gear · 16", "Event · 2", "Materials · 31", "Cooking · 9"]);
  expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
  expect(tabs[1]?.getAttribute("aria-selected")).toBe("false");
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
