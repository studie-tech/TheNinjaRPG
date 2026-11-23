import { afterEach, expect, it } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { MapAnchored } from "@/layout/map/MapAnchored";
import { MapSpeech } from "@/layout/map/MapSpeech";
import { SpeechBubble } from "@/layout/map/SpeechBubble";
import {
  createMapAnchors,
  type MapAnchorPoint,
  type MapAnchors,
} from "@/libs/mapAnchors";
import type { MapSpeechLine } from "@/libs/mapSpeech";

afterEach(cleanup);

const point = (patch: Partial<MapAnchorPoint> = {}): MapAnchorPoint => ({
  x: 350,
  foot: 320,
  top: 280,
  tile: 40,
  width: 700,
  height: 600,
  ...patch,
});
/** What a scene does each frame: report every wanted anchor, by its actor key or kind. */
const frame = (anchors: MapAnchors, points: Record<string, MapAnchorPoint>) =>
  act(() => {
    for (const [id, { anchor }] of anchors.wanted())
      anchors.report(
        id,
        points[anchor.kind === "actor" ? anchor.key : anchor.kind] ?? null,
      );
  });
const line = (id: string, key: string, patch: Partial<MapSpeechLine> = {}) =>
  ({ id, anchor: { kind: "actor", key }, text: `${key} speaks`, ...patch }) as const;

it("shows a line once its speaker is on the map and follows them as they walk", () => {
  const anchors = createMapAnchors();
  const view = render(
    <MapSpeech anchors={anchors} lines={[line("a", "lemu", { speaker: "Lemu" })]} />,
  );
  const bubble = view.container.querySelector<HTMLElement>("[data-map-speech-line=a]")!;
  expect(bubble.style.visibility).toBe("hidden");
  frame(anchors, { lemu: point() });
  expect(bubble.style.visibility).toBe("");
  expect(bubble.dataset.speechSide).toBe("above");
  expect(view.getByText("Lemu")).toBeTruthy();
  const before = bubble.style.transform;
  frame(anchors, { lemu: point({ x: 420 }) });
  expect(bubble.style.transform).not.toBe(before);
  frame(anchors, {});
  expect(bubble.style.visibility).toBe("hidden");
});

it("announces each character's line and drops the ones that end", () => {
  const anchors = createMapAnchors();
  const lines = [line("a", "lemu"), line("b", "pup", { tone: "shout" })];
  const view = render(<MapSpeech anchors={anchors} lines={lines} />);
  frame(anchors, { lemu: point(), pup: point({ x: 600 }) });
  expect(view.getAllByRole("status").map((status) => status.textContent)).toEqual([
    "lemu speaks",
    "pup speaks",
  ]);
  view.rerender(<MapSpeech anchors={anchors} lines={lines.slice(1)} />);
  expect(view.getAllByRole("status")).toHaveLength(1);
  expect([...anchors.wanted().values()]).toHaveLength(1);
  view.unmount();
  expect(anchors.wanted().size).toBe(0);
});

it("lets a line carry the controls that answer it", () => {
  const view = render(
    <SpeechBubble speaker="Lemu" footer={<button type="button">Yes</button>}>
      Ready?
    </SpeechBubble>,
  );
  const answer = view.getByRole("button", { name: "Yes" });
  expect(answer.closest(".pointer-events-auto")).toBeTruthy();
});

it("keeps a box over something on the map and hides it off the map", () => {
  const anchors = createMapAnchors();
  const view = render(
    <MapAnchored
      anchors={anchors}
      anchor={{ kind: "objective" }}
      box={{ width: 2, height: 1 }}
      id="target"
    />,
  );
  const box = view.container.querySelector<HTMLElement>("#target")!;
  expect(box.style.display).toBe("none");
  frame(anchors, { objective: point() });
  expect([box.style.left, box.style.width, box.style.display]).toEqual([
    "350px",
    "80px",
    "",
  ]);
  frame(anchors, { objective: point({ x: -50 }) });
  expect(box.style.display).toBe("none");
});
