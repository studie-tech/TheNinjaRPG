import { JSDOM } from "jsdom";

export let cleanupDom = () => {};

if (typeof document === "undefined") {
  const originalGlobals = new Map(
    ["window", "document", "navigator"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const addedWindowKeys = [];
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
      Object.defineProperty(
        globalThis,
        key,
        { ...descriptor, configurable: true },
      );
      addedWindowKeys.push(key);
    }
  }

  cleanupDom = () => {
    dom.window.close();
    for (const key of addedWindowKeys) Reflect.deleteProperty(globalThis, key);
    for (const [key, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}
