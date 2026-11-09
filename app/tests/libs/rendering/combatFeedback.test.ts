import { afterAll, beforeAll, describe, expect, it, vi } from "bun:test";
import { Text } from "pixi.js";
import type { HitSeverity } from "@/libs/combat/playback";
import { createCombatFeedback } from "@/libs/rendering/scenes/combatFeedback";

// Gradient text styles paint through a canvas context, which the test DOM does not provide.
beforeAll(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        createLinearGradient: () => ({ addColorStop() {} }),
        fillRect() {},
      }) as never,
  );
});
afterAll(() => vi.restoreAllMocks());

type Feedback = ReturnType<typeof createCombatFeedback>;
const numbers = (feedback: Feedback) =>
  feedback.container.children.filter((child): child is Text => child instanceof Text);
const shown = (feedback: Feedback) => numbers(feedback).filter((text) => text.visible);
const hit = (amount: number, severity: HitSeverity = "light", userId = "a") => ({
  userId,
  amount,
  severity,
  x: 0,
  y: 100,
  dirX: 1,
});

describe("combat damage numbers", () => {
  it("shows damage and healing with separate styles, and marks crushing blows", () => {
    const feedback = createCombatFeedback(40);
    feedback.show(hit(-1200));
    feedback.show(hit(35, "light", "b"));
    feedback.show(hit(-5000, "crushing", "c"));
    feedback.animate(0, false, 1);
    const [damage, heal, crushing] = shown(feedback);
    expect(damage?.text).toBe("1,200");
    expect(heal?.text).toBe("+35");
    expect(crushing?.text).toBe("5,000!");
    expect(damage?.style).not.toBe(heal?.style);
    expect(damage?.style).not.toBe(crushing?.style);
  });

  it("reads upright on the battlefield's flipped Y axis", () => {
    const feedback = createCombatFeedback(40);
    feedback.show(hit(-1));
    feedback.animate(0, false, 1);
    const [text] = shown(feedback);
    expect(text?.scale.x).toBeGreaterThan(0);
    expect(text?.scale.y).toBeLessThan(0);
  });

  it("slams in oversized, then settles", () => {
    const feedback = createCombatFeedback(40);
    feedback.show(hit(-1));
    feedback.animate(0, false, 1);
    const [text] = shown(feedback);
    const entry = text?.scale.x ?? 0;
    feedback.animate(400, false, 1);
    expect(text?.scale.x).toBeLessThan(entry);
  });

  it("is thrown along the blow, fades and retires", () => {
    const feedback = createCombatFeedback(40);
    feedback.show(hit(-1));
    feedback.animate(0, false, 1);
    const [text] = shown(feedback);
    feedback.animate(500, false, 1);
    expect(text?.y).toBeGreaterThan(100);
    expect(text?.x).toBeGreaterThan(0);
    expect(text?.alpha).toBe(1);
    feedback.animate(900, false, 1);
    expect(text?.alpha).toBeLessThan(1);
    feedback.animate(1000, false, 1);
    expect(feedback.active()).toBe(0);
    expect(shown(feedback)).toEqual([]);
  });

  it("makes harder hits larger", () => {
    const size = (severity: HitSeverity) => {
      const feedback = createCombatFeedback(40);
      feedback.show(hit(-1, severity));
      feedback.animate(200, false, 1);
      feedback.animate(400, false, 1);
      return shown(feedback)[0]?.scale.x ?? 0;
    };
    expect(size("heavy")).toBeGreaterThan(size("light"));
    expect(size("crushing")).toBeGreaterThan(size("heavy"));
  });

  it("stacks repeated hits on one fighter without overlapping", () => {
    const feedback = createCombatFeedback(40);
    feedback.show(hit(-1));
    feedback.show(hit(-2));
    feedback.animate(0, false, 1);
    const [first, second] = shown(feedback);
    expect(second?.y).toBeGreaterThan(first?.y ?? 0);
  });

  it("keeps a minimum on-screen size on a small field", () => {
    const feedback = createCombatFeedback(10);
    feedback.animate(0, false, 0.25);
    feedback.show(hit(-1));
    feedback.animate(500, false, 0.25);
    const [text] = shown(feedback);
    expect(Math.abs(text?.scale.y ?? 0) * 48 * 0.25).toBeGreaterThanOrEqual(13);
  });

  it("reuses a fixed pool, replacing the oldest number in a burst", () => {
    const feedback = createCombatFeedback(40);
    const objects = [...numbers(feedback)];
    for (let index = 0; index < 40; index++) {
      feedback.animate(index, false, 1);
      feedback.show(hit(-(index + 1), "light", `fighter-${index}`));
    }
    expect(numbers(feedback)).toEqual(objects);
    expect(shown(feedback).map((text) => text.text)).toContain("40");
    expect(shown(feedback).map((text) => text.text)).not.toContain("1");
  });

  it("does not change glyphs while animating", () => {
    const feedback = createCombatFeedback(40);
    feedback.show(hit(-5));
    const [text] = shown(feedback);
    let writes = 0;
    const original = text!.text;
    Object.defineProperty(text, "text", {
      get: () => original,
      set: () => {
        writes++;
      },
    });
    for (let tick = 0; tick < 30; tick++) feedback.animate(tick * 16, false, 1);
    expect(writes).toBe(0);
  });
});

describe("combat camera kick", () => {
  const reach = (feedback: Feedback, clock: number) => {
    feedback.animate(clock, false, 1);
    return Math.hypot(feedback.shake.x, feedback.shake.y);
  };

  it("leaves light hits and heals alone", () => {
    const feedback = createCombatFeedback(40);
    feedback.show(hit(-1, "light"));
    feedback.show(hit(5, "light", "b"));
    expect(reach(feedback, 20)).toBe(0);
  });

  it("kicks harder for harder hits, then settles exactly", () => {
    const kick = (severity: HitSeverity) => {
      const feedback = createCombatFeedback(40);
      feedback.show(hit(-1, severity));
      return Math.max(reach(feedback, 20), reach(feedback, 30));
    };
    expect(kick("crushing")).toBeGreaterThan(kick("heavy"));
    const feedback = createCombatFeedback(40);
    feedback.show(hit(-1, "crushing"));
    expect(reach(feedback, 400)).toBe(0);
  });

  it("stays still for reduced motion", () => {
    const feedback = createCombatFeedback(40);
    feedback.show(hit(-1, "crushing"));
    feedback.animate(20, true, 1);
    expect(feedback.shake).toEqual({ x: 0, y: 0 });
  });

  it("does not let a light hit cut a heavy kick short", () => {
    const feedback = createCombatFeedback(40);
    feedback.show(hit(-1, "crushing"));
    const before = reach(feedback, 40);
    feedback.show(hit(-1, "light", "b"));
    expect(Math.max(reach(feedback, 48), reach(feedback, 56))).toBeGreaterThan(
      before / 3,
    );
  });
});
