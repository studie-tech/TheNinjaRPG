import { afterEach, describe, expect, it } from "bun:test";
import { installBrowserGlobals, restoreBrowserGlobals } from "./browserGlobals";

describe("browser globals", () => {
  const nativeEvent = globalThis.Event;
  const nativeCustomEvent = globalThis.CustomEvent;
  const nativeFrame = globalThis.requestAnimationFrame;

  afterEach(() => {
    restoreBrowserGlobals();
    restoreBrowserGlobals();
  });

  it("installs the DOM's event constructors and puts Bun's back", () => {
    installBrowserGlobals();
    expect(globalThis.Event).toBe(window.Event);
    expect(globalThis.CustomEvent).toBe(window.CustomEvent);
    restoreBrowserGlobals();
    expect(globalThis.Event).toBe(nativeEvent);
    expect(globalThis.CustomEvent).toBe(nativeCustomEvent);
  });

  it("removes stubs for globals that did not exist and restores replaced ones", () => {
    const hadResizeObserver = "ResizeObserver" in globalThis;
    const scroll = () => undefined;
    installBrowserGlobals({
      events: ["CustomEvent"],
      resizeObserver: true,
      scrollIntoView: scroll,
      animationFrame: true,
    });
    expect(globalThis.Event).toBe(nativeEvent);
    expect(globalThis.CustomEvent).toBe(window.CustomEvent);
    expect(new ResizeObserver(() => undefined).observe).toBeTypeOf("function");
    expect(HTMLElement.prototype.scrollIntoView).toBe(scroll);
    expect(globalThis.requestAnimationFrame).not.toBe(nativeFrame);
    restoreBrowserGlobals();
    expect("ResizeObserver" in globalThis).toBe(hadResizeObserver);
    expect(Object.hasOwn(HTMLElement.prototype, "scrollIntoView")).toBe(false);
    expect(globalThis.requestAnimationFrame).toBe(nativeFrame);
  });

  it("restores nested installs innermost first", () => {
    installBrowserGlobals();
    installBrowserGlobals({ events: [], scrollIntoView: true });
    restoreBrowserGlobals();
    expect(Object.hasOwn(HTMLElement.prototype, "scrollIntoView")).toBe(false);
    expect(globalThis.Event).toBe(window.Event);
    restoreBrowserGlobals();
    expect(globalThis.Event).toBe(nativeEvent);
  });

  it("runs animation frames on timers until cancelled", async () => {
    installBrowserGlobals({ events: [], animationFrame: true });
    const frames: number[] = [];
    requestAnimationFrame((time) => frames.push(time));
    cancelAnimationFrame(requestAnimationFrame(() => frames.push(-1)));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toBeGreaterThan(0);
  });
});
