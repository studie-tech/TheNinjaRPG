import { cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { PerspectiveCamera } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { forwardVerticalWheelToDocumentScroll } from "@/components/layout/shared/layoutUtils";
import { TrackballControls } from "@/libs/threejs/TrackBallControls";

const originalScrollingElement = Object.getOwnPropertyDescriptor(document, "scrollingElement");

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalScrollingElement) {
    Object.defineProperty(document, "scrollingElement", originalScrollingElement);
  } else {
    Reflect.deleteProperty(document, "scrollingElement");
  }
});

const setup = () => {
  const page = document.documentElement;
  Object.defineProperty(document, "scrollingElement", { configurable: true, value: page });
  vi.spyOn(page, "scrollHeight", "get").mockReturnValue(2000);
  vi.spyOn(page, "clientHeight", "get").mockReturnValue(500);
  page.scrollTop = 500;
  return render(
    <div onWheel={forwardVerticalWheelToDocumentScroll}>
      <canvas data-testid="map" />
      <div data-testid="content">Page content</div>
    </div>,
  );
};

describe("layout wheel forwarding", () => {
  it.each([-100, 100])("preserves map zoom without page scroll for delta %s", (deltaY) => {
    const view = setup();
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 100);
    const canvas = view.getByTestId("map");
    const controls = new TrackballControls(camera, canvas);
    controls.staticMoving = true;
    try {
      fireEvent.wheel(canvas, { deltaY, bubbles: true, cancelable: true });
      controls.update();
      expect(document.documentElement.scrollTop).toBe(500);
      if (deltaY > 0) expect(camera.position.length()).toBeGreaterThan(100);
      else expect(camera.position.length()).toBeLessThan(100);
    } finally {
      controls.dispose();
    }
  });

  it("still forwards unhandled vertical wheel input to the document", () => {
    const view = setup();
    fireEvent.wheel(view.getByTestId("content"), { deltaY: 100 });
    expect(document.documentElement.scrollTop).toBe(600);
  });
});
