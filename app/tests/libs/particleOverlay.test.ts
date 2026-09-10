import { ensureDom } from "../setup-dom.mjs";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFETTI_OVERLAY_ID,
  applyParticleOverlayStyle,
  ensureParticleOverlayCanvas,
  particleOverlayStyle,
} from "@/libs/particleOverlay";

ensureDom();

afterEach(() => {
  document.getElementById(CONFETTI_OVERLAY_ID)?.remove();
  document.getElementById("tsparticles")?.remove();
});

describe("particleOverlayStyle", () => {
  it("takes the host out of document flow", () => {
    const style = particleOverlayStyle(50);
    expect(style.position).toBe("fixed");
    expect(style.inset).toBe("0px");
    expect(style.contain).toBe("strict");
    expect(style.pointerEvents).toBe("none");
    expect(style.zIndex).toBe(50);
  });
});

describe("ensureParticleOverlayCanvas", () => {
  it("styles the canvas before inserting it into the document", () => {
    const seen: CSSStyleDeclaration[] = [];
    const original = document.body.appendChild.bind(document.body);
    document.body.appendChild = ((node: Node) => {
      if (node instanceof HTMLElement) {
        seen.push(node.style);
        expect(node.style.position).toBe("fixed");
        expect(node.style.contain).toBe("strict");
        expect(node.style.pointerEvents).toBe("none");
        expect(node.id).toBe(CONFETTI_OVERLAY_ID);
      }
      return original(node);
    }) as typeof document.body.appendChild;

    try {
      const canvas = ensureParticleOverlayCanvas(CONFETTI_OVERLAY_ID, 50);
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      expect(seen).toHaveLength(1);
      expect(document.getElementById(CONFETTI_OVERLAY_ID)).toBe(canvas);
    } finally {
      document.body.appendChild = original;
    }
  });

  it("reuses an existing canvas instead of inserting a second host", () => {
    const first = ensureParticleOverlayCanvas(CONFETTI_OVERLAY_ID, 50);
    const second = ensureParticleOverlayCanvas(CONFETTI_OVERLAY_ID, 50);
    expect(second).toBe(first);
    expect(document.querySelectorAll(`#${CONFETTI_OVERLAY_ID}`)).toHaveLength(1);
  });

  it("restyles a pre-existing in-flow canvas so it cannot shift layout", () => {
    const stray = document.createElement("canvas");
    stray.id = CONFETTI_OVERLAY_ID;
    document.body.appendChild(stray);

    const reused = ensureParticleOverlayCanvas(CONFETTI_OVERLAY_ID, 50);
    expect(reused).toBe(stray);
    expect(stray.style.position).toBe("fixed");
    expect(stray.style.contain).toBe("strict");
  });

  it("does not replace a non-canvas host that already owns the id", () => {
    const host = document.createElement("div");
    host.id = "tsparticles";
    document.body.appendChild(host);

    const canvas = ensureParticleOverlayCanvas("tsparticles", 0);
    expect(canvas).toBeNull();
    expect(host.style.position).toBe("fixed");
    expect(document.getElementById("tsparticles")).toBe(host);
  });
});

describe("applyParticleOverlayStyle", () => {
  it("marks the host inert for assistive tech", () => {
    const element = document.createElement("div");
    applyParticleOverlayStyle(element, 0);
    expect(element.getAttribute("aria-hidden")).toBe("true");
  });
});
