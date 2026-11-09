import { installBrowserGlobals, restoreBrowserGlobals } from "./browserGlobals";

/** Supply layout observers and the color-scheme query for the real shadow-DOM picker in jsdom. */
export const installEmojiPickerBrowserGlobals = () => {
  installBrowserGlobals({ resizeObserver: true });
  const apis = {
    matchMedia: (media: string) => ({
      media,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    IntersectionObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  };
  const originals = Object.keys(apis).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(apis)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    restoreBrowserGlobals();
  };
};
