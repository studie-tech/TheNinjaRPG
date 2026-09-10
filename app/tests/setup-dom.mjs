import { JSDOM } from "jsdom";

let installed = false;

/**
 * Installs a jsdom environment when `document` is missing.
 * Safe to call repeatedly — including after another suite tore globals down.
 * Do not call cleanup between suites when tests share a process; use this instead.
 */
export const ensureDom = () => {
  if (typeof document !== "undefined") {
    installed = true;
    return;
  }

  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
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

  installed = true;
};

ensureDom();
