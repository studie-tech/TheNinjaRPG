import { describe, expect, it } from "bun:test";
import { type DockPlace, getDockPlace } from "@/layout/tutorial/dockPlacement";

const column = { left: 560, top: 260, width: 690, height: 900 };
const wide = { width: 1824, height: 809 };
const place = (overrides: Partial<Parameters<typeof getDockPlace>[0]> = {}) =>
  getDockPlace({
    target: { left: 1307, top: 297, width: 178, height: 24 },
    lit: { left: 1301, top: 261, width: 190, height: 66 },
    column,
    height: 200,
    viewport: wide,
    preferredSide: "left",
    ...overrides,
  });

describe("where a lesson stands beside its subject", () => {
  it("stands on the inner side of a sidebar's box, level with the control", () => {
    const found = place();
    expect(found).toEqual({ left: 867, top: 209, width: 420 });
  });

  it("keeps to its side of a lit page, wherever the control is", () => {
    const lit = { left: 554, top: 101, width: 702, height: 640 };
    const target = { left: 1100, top: 400, width: 100, height: 100 };
    for (const left of [600, 800, 1100]) {
      const at = { target: { ...target, left }, lit };
      expect(place({ ...at, preferredSide: "right" })?.left).toBe(1270);
      expect(place({ ...at, preferredSide: "left" })?.left).toBe(120);
    }
  });

  it("leaves a short lit box's top and foot alone while its side has room", () => {
    const found = place({
      target: { left: 600, top: 315, width: 80, height: 40 },
      lit: { left: 554, top: 264, width: 702, height: 110 },
      preferredSide: "right",
    });
    expect(found?.left).toBe(1270);
  });

  it("takes the other side when its own has no room", () => {
    const lit = { left: 554, top: 101, width: 702, height: 640 };
    const found = place({
      target: { left: 600, top: 400, width: 100, height: 100 },
      lit,
      preferredSide: "right",
      viewport: { width: 1400, height: 809 },
    });
    expect(found?.left).toBeLessThan(lit.left);
  });

  it("keeps within the screen beside a control at its foot", () => {
    const found = place({
      target: { left: 1307, top: 760, width: 100, height: 30 },
      lit: { left: 554, top: 101, width: 900, height: 700 },
    });
    expect(found?.top).toBe(809 - 12 - 200);
  });

  it("narrows into the gutter, and over the lit box's edge at most a little", () => {
    const viewport = { width: 1440, height: 900 };
    const lit = { left: 362, top: 101, width: 702, height: 640 };
    const target = { left: 900, top: 400, width: 100, height: 100 };
    expect(place({ viewport, lit, target, preferredSide: "right" })).toEqual({
      left: 1078,
      top: 350,
      width: 350,
    });
    const narrow = place({
      viewport: { width: 1280, height: 900 },
      lit: { ...lit, left: 282 },
      target: { ...target, left: 500 },
      preferredSide: "right",
    });
    expect(narrow?.width).toBe(272);
    expect(narrow && (narrow.left < 282 || narrow.left >= 984 - 64)).toBe(true);
  });

  it("stands above or below a box with no room beside it", () => {
    const found = place({
      viewport: { width: 800, height: 900 },
      lit: { left: 20, top: 100, width: 760, height: 200 },
      target: { left: 300, top: 150, width: 100, height: 40 },
      column: null,
    });
    expect(found?.top).toBe(314);
  });

  it("stands under the hand that hangs below its box", () => {
    const found = place({
      viewport: { width: 753, height: 1024 },
      lit: { left: 203, top: 209, width: 347, height: 309 },
      target: { left: 220, top: 375, width: 313, height: 126 },
      column: null,
      height: 274,
    });
    expect(found?.top).toBe(501 + 76 + 14);
  });

  it("has no place around a box that fills the screen", () => {
    expect(
      place({
        viewport: { width: 800, height: 900 },
        lit: { left: 10, top: 20, width: 780, height: 860 },
        target: { left: 300, top: 150, width: 100, height: 40 },
      }),
    ).toBeNull();
    expect(place({ height: 800 })).toBeNull();
  });

  it("leaves the hand under a control and the marked elements in view", () => {
    const clear = (found: DockPlace | null, box: { top: number; height: number }) =>
      !!found && (found.top >= box.top + box.height || found.top + 200 <= box.top);
    const mark = { left: 900, top: 250, width: 200, height: 40 };
    const found = place({ marks: [mark] });
    expect(
      clear(found, mark) || (found?.left ?? 0) + (found?.width ?? 0) <= mark.left,
    ).toBe(true);
  });

  it("stays where it stands until a better place is worth the move", () => {
    const current = { left: 867, top: 260, width: 420 };
    expect(place({ current, patience: 140 })).toBe(current);
    expect(place({ current, patience: 0 })?.top).toBe(209);
    // Covering the control or its box is never patient.
    const covering = { left: 1000, top: 260, width: 420 };
    expect(place({ current: covering, patience: 1000 })).not.toBe(covering);
  });
});
