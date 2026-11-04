import { JSDOM } from "jsdom";

/**
 * Bunfig preload that installs one jsdom environment before any suite loads. Suites that
 * swap `document` or `window` restore them in `afterEach`.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
});

for (const key of Reflect.ownKeys(dom.window)) {
  if (!(key in globalThis)) {
    const descriptor = Object.getOwnPropertyDescriptor(dom.window, key);
    if (!descriptor) continue;
    Object.defineProperty(globalThis, key, { ...descriptor, configurable: true });
  }
}
