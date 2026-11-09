import { afterEach, beforeEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { CombatTargetPreview } from "@/layout/CombatTargetPreview";
import * as modal from "@/layout/Modal";
import { getBattleGrid } from "@/libs/combat/util";
import type { ReturnedBattle } from "@/libs/combat/types";
import * as battlefield from "@/libs/rendering/scenes/battlefieldPreview";

const dispose = vi.fn();
const setTargeting = vi.fn();
const createPreview = vi.fn(
  ({ targeting }: { targeting: { width: number; height: number } }) => {
    const canvas = document.createElement("canvas");
    return {
      canvas,
      grid: getBattleGrid(20, targeting as ReturnedBattle, { x: -10, y: -10 }),
      width: 300,
      height: 250,
      play: vi.fn(),
      setTargeting,
      dispose: () => {
        dispose();
        canvas.remove();
      },
    };
  },
);
beforeEach(() => {
  vi.spyOn(battlefield, "createBattlefieldPreview").mockImplementation(
    createPreview as never,
  );
  vi.spyOn(modal, "default").mockImplementation((props) => (
    <div role="dialog" aria-label={props.title}>
      {props.children}
      <button type="button" onClick={() => props.setIsOpen(false)}>
        Close
      </button>
    </div>
  ));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
it("loads combat rendering only when requested and releases it when help closes", async () => {
  const view = render(<CombatTargetPreview action={{ method: "SINGLE", range: 2 }} />);
  const trigger = view.getByRole("button", { name: "Preview targeting" });
  expect(view.queryByRole("dialog")).toBeNull();
  expect(createPreview).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  await view.findByRole("button", { name: "A1 (0, 0)" });
  expect(createPreview).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(setTargeting).toHaveBeenCalled());
  fireEvent.click(view.getAllByRole("button", { name: "Close" }).at(-1)!);
  await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  expect(dispose).toHaveBeenCalledTimes(1);
});
it("shows recoverable feedback when the combat renderer is unavailable", async () => {
  createPreview.mockReturnValueOnce(null as never);
  const view = render(<CombatTargetPreview action={{ method: "SINGLE", range: 2 }} />);
  fireEvent.click(view.getByRole("button", { name: "Preview targeting" }));
  expect((await view.findByRole("alert")).textContent).toContain("requires WebGL");
  expect(view.queryByText("Loading combat grid…")).toBeNull();
  expect(dispose).not.toHaveBeenCalled();
});
it("updates coordinate origins, exclusions and random candidates on the preview grid", async () => {
  const pattern = {
    origin: "BATTLEFIELD" as const,
    selection: "ALL" as const,
    coordinates: [{ longitude: 0, latitude: 0 }],
    randomCount: 2,
  };
  const view = render(
    <CombatTargetPreview
      action={{ method: "COORDINATES", range: 0, coordinateTargeting: pattern }}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Preview targeting" }));
  expect(await view.findByRole("button", { name: "A1 (0, 0) affected" })).toBeTruthy();
  view.rerender(
    <CombatTargetPreview
      action={{
        method: "COORDINATES",
        range: 0,
        coordinateTargeting: { ...pattern, origin: "TARGET" },
      }}
    />,
  );
  expect(view.getByRole("button", { name: "H5 (7, 4) affected T" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "B2 (1, 1)" }));
  expect(view.getByRole("button", { name: "B2 (1, 1) affected T" })).toBeTruthy();
  view.rerender(
    <CombatTargetPreview
      action={{
        method: "COORDINATES",
        range: 0,
        coordinateTargeting: { ...pattern, selection: "EXCLUDE" },
      }}
    />,
  );
  expect(view.getByText(/119 affected tiles/)).toBeTruthy();
  view.rerender(
    <CombatTargetPreview
      action={{
        method: "COORDINATES",
        range: 0,
        coordinateTargeting: { ...pattern, selection: "RANDOM", coordinates: [] },
      }}
    />,
  );
  expect(view.getByText(/120 candidate tiles; up to 2 chosen per cast/)).toBeTruthy();
});
it("clips to resized maps and moves caster using the keyboard", async () => {
  const view = render(
    <CombatTargetPreview
      action={{ method: "SINGLE", range: 2, methodSize: { x: 1, y: 0 } }}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Preview targeting" }));
  expect(await view.findByText(/3 affected tiles/)).toBeTruthy();
  fireEvent.input(view.getByLabelText("Preview columns"), { target: { value: "1" } });
  expect(await view.findByText(/1 affected tiles/)).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Place caster (C)" }));
  fireEvent.keyDown(view.getByRole("button", { name: "A1 (0, 0)" }), { key: "Enter" });
  expect(view.getByText(/Caster: \(0, 0\)/)).toBeTruthy();
});
it("keeps one grid tab stop while arrows navigate without placing and rerenders preserve focus", async () => {
  const action = { method: "SINGLE" as const, range: 2 };
  const view = render(<CombatTargetPreview action={action} />);
  fireEvent.click(view.getByRole("button", { name: "Preview targeting" }));
  await view.findByRole("button", { name: "A1 (0, 0)" });
  const tabStops = () => view.baseElement.querySelectorAll('svg [tabindex="0"]');
  const tile = (name: string) =>
    view.getByRole("button", { name: new RegExp(`^${name} \\(`) });
  expect(tabStops()).toHaveLength(1);
  expect(tabStops()[0]).toBe(tile("A1"));
  fireEvent.click(tile("A1"));
  for (const key of ["ArrowLeft", "ArrowDown"]) {
    fireEvent.keyDown(document.activeElement!, { key });
    expect(document.activeElement).toBe(tile("A1"));
  }
  fireEvent.keyDown(tile("A1"), { key: "ArrowRight" });
  expect(document.activeElement).toBe(tile("B1"));
  fireEvent.keyDown(tile("B1"), { key: "ArrowUp" });
  expect(document.activeElement).toBe(tile("B2"));
  expect(view.getByText(/target: \(0, 0\)/)).toBeTruthy();
  expect(tabStops()).toHaveLength(1);
  expect(tabStops()[0]).toBe(tile("B2"));
  fireEvent.keyDown(tile("B2"), { key: "Enter" });
  expect(view.getByText(/target: \(1, 1\)/)).toBeTruthy();
  view.rerender(
    <CombatTargetPreview action={{ ...action, methodSize: { x: 1, y: 1 } }} />,
  );
  expect(document.activeElement).toBe(tile("B2"));
  expect(tabStops()).toHaveLength(1);
  expect(tabStops()[0]).toBe(tile("B2"));
  fireEvent.click(view.getByRole("button", { name: "Place caster (C)" }));
  fireEvent.keyDown(tile("B2"), { key: " " });
  expect(view.getByText(/Caster: \(1, 1\)/)).toBeTruthy();
});
it("keeps the keyboard entry within resized maps after mouse selection", async () => {
  const view = render(<CombatTargetPreview action={{ method: "SINGLE", range: 2 }} />);
  fireEvent.click(view.getByRole("button", { name: "Preview targeting" }));
  await view.findByRole("button", { name: "L10 (11, 9)" });
  const tabStops = () => view.baseElement.querySelectorAll('svg [tabindex="0"]');
  fireEvent.click(view.getByRole("button", { name: "L10 (11, 9)" }));
  expect(document.activeElement).toBe(tabStops()[0] ?? null);
  expect(view.getByText(/target: \(11, 9\)/)).toBeTruthy();
  fireEvent.input(view.getByLabelText("Preview columns"), { target: { value: "2" } });
  fireEvent.input(view.getByLabelText("Preview rows"), { target: { value: "2" } });
  const corner = await view.findByRole("button", { name: "B2 (1, 1) affected C/T" });
  expect(tabStops()).toHaveLength(1);
  expect(tabStops()[0]).toBe(corner);
  fireEvent.click(corner);
  fireEvent.keyDown(corner, { key: "ArrowRight" });
  fireEvent.keyDown(corner, { key: "ArrowUp" });
  expect(document.activeElement).toBe(corner);
  fireEvent.input(view.getByLabelText("Preview columns"), { target: { value: "12" } });
  fireEvent.input(view.getByLabelText("Preview rows"), { target: { value: "10" } });
  await view.findByRole("button", { name: "L10 (11, 9)" });
  expect(tabStops()).toHaveLength(1);
  expect(tabStops()[0]).toBe(
    view.getByRole("button", { name: "B2 (1, 1) affected T" }),
  );
});
