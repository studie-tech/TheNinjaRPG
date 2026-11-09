type BrowserGlobalOptions = {
  /** Bun's own constructors win over jsdom's in the preload; Radix needs jsdom's on jsdom nodes. */
  events?: readonly ("Event" | "CustomEvent")[];
  /** `true` installs a no-op; a class stands in for suites that report measurements. */
  resizeObserver?: boolean | (new (...args: never[]) => unknown);
  /** `true` installs a no-op; a function stands in for suites that assert on scrolling. */
  scrollIntoView?: boolean | (() => void);
  /** `true` runs frames on timers, independent of jsdom intervals that fake timers clear. */
  animationFrame?: boolean | ((callback: FrameRequestCallback) => number);
};

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const timerFrame = (callback: FrameRequestCallback) =>
  Number(setTimeout(() => callback(Date.now()), 0));

const installed: (() => void)[] = [];

/** Replace an own property, returning the step that puts back or removes the original. */
const swapProperty = (target: object, key: string, value: unknown) => {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else Reflect.deleteProperty(target, key);
  };
};

/**
 * Install the browser globals a suite's UI needs; server suites keep Bun's own `Event`, so this
 * stays opt-in. Each call pairs with one `restoreBrowserGlobals()`, which belongs in the suite's
 * own `afterEach`, after `cleanup()` and `flushRadixFocus()`: hooks of one scope run in declaration
 * order, so a helper-registered `afterEach` would restore before the suite unmounts Radix.
 */
export const installBrowserGlobals = ({
  events = ["Event", "CustomEvent"],
  resizeObserver = false,
  scrollIntoView = false,
  animationFrame = false,
}: BrowserGlobalOptions = {}) => {
  const restores = events.map((key) => swapProperty(globalThis, key, window[key]));
  if (resizeObserver) {
    const stub = resizeObserver === true ? NoopResizeObserver : resizeObserver;
    restores.push(swapProperty(globalThis, "ResizeObserver", stub));
  }
  if (scrollIntoView) {
    const stub = scrollIntoView === true ? () => undefined : scrollIntoView;
    restores.push(swapProperty(HTMLElement.prototype, "scrollIntoView", stub));
  }
  if (animationFrame) {
    const stub = animationFrame === true ? timerFrame : animationFrame;
    restores.push(swapProperty(globalThis, "requestAnimationFrame", stub));
    restores.push(
      swapProperty(globalThis, "cancelAnimationFrame", (id: number) =>
        clearTimeout(id),
      ),
    );
  }
  installed.push(() => {
    for (const restore of restores) restore();
  });
};

/** Undo the latest `installBrowserGlobals()`; a no-op for tests that installed nothing. */
export const restoreBrowserGlobals = () => {
  installed.pop()?.();
};

/** Radix restores focus on the next task, still dispatching with the DOM's constructors. */
export const flushRadixFocus = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
