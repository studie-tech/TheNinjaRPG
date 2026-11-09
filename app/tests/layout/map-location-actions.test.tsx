import { afterEach, expect, it, vi } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MapLocationActions } from "@/layout/MapLocationActions";
import type { MapLocation } from "@/validators/mapLocation";

afterEach(cleanup);
const tower: MapLocation = {
  id: "tower",
  name: "Old Watchtower",
  description: "A tower.",
  assetId: "tower-art",
  sector: 724,
  longitude: 4,
  latitude: 5,
  scale: 1,
};

it("shows visitors Inspect without offering or triggering quest actions", () => {
  const onInspect = vi.fn();
  const onQuest = vi.fn();
  const onGoTo = vi.fn();
  const view = render(
    <MapLocationActions
      arrived={[tower]}
      onInspect={onInspect}
      onQuest={onQuest}
      onGoTo={onGoTo}
    />,
  );
  const inspectButton = view.getByRole("button", { name: "Inspect" });
  fireEvent.click(inspectButton);
  expect(onInspect).toHaveBeenCalledWith(tower, inspectButton);
  expect(onQuest).not.toHaveBeenCalled();
  expect(onGoTo).not.toHaveBeenCalled();
  expect(view.queryByRole("button", { name: /^Quest$/ })).toBeNull();
});

it("keeps a selected destination accessible while standing at another landmark", () => {
  const hut = { ...tower, id: "hut", name: "Herbalist Hut", longitude: 9 };
  const onGoTo = vi.fn();
  const view = render(
    <MapLocationActions
      arrived={[tower]}
      hovered={hut}
      onInspect={vi.fn()}
      onQuest={vi.fn()}
      onGoTo={onGoTo}
    />,
  );
  expect(view.getByRole("button", { name: "Inspect" })).toBeTruthy();
  fireEvent.click(view.getByRole("button", { name: "Go to Herbalist Hut" }));
  expect(onGoTo).toHaveBeenCalledWith(hut);
});

it("keeps bound NPC progress in the NPC interaction flow", () => {
  const onQuest = vi.fn();
  const view = render(
    <MapLocationActions
      arrived={[{ ...tower, active: true, questId: "quest", npcPlacementId: "npc" }]}
      onInspect={vi.fn()}
      onQuest={onQuest}
      onGoTo={vi.fn()}
    />,
  );
  expect(view.queryByRole("button", { name: /^Quest$/ })).toBeNull();
  expect(view.getByText("Speak with the NPC here to continue.")).toBeTruthy();
  expect(onQuest).not.toHaveBeenCalled();
});
