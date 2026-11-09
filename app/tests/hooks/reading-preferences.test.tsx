import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import {
  ReadingPreferencesProvider,
  useReadingPreferences,
} from "@/hooks/useReadingPreferences";
import {
  applyReadingPreferences,
  DEFAULT_READING_PREFERENCES,
  parseReadingPreferences,
  READING_ATTRIBUTES,
  READING_OPTIONS,
  READING_PREFERENCES_SCRIPT,
  READING_PREFERENCES_STORAGE_KEY,
} from "@/libs/readingPreferences";

const saved = {
  font: "atkinson",
  spacing: "wider",
  lineHeight: "spacious",
  palette: "cream",
} as const;

/** Exposes the context value in markup to compare server and browser renders. */
const Probe = () => {
  const { preferences } = useReadingPreferences();
  return <span>{preferences.font}</span>;
};

/** Mounts the public hook under its real provider, including persistence effects. */
const renderPreferences = () =>
  renderHook(() => useReadingPreferences(), { wrapper: ReadingPreferencesProvider });

/** Executes the literal bootstrap with the same script attributes as the root layout. */
const runHeadScript = () => {
  const script = document.createElement("script");
  script.setAttribute("data-storage-key", READING_PREFERENCES_STORAGE_KEY);
  script.setAttribute("data-options", JSON.stringify(READING_OPTIONS));
  script.setAttribute("data-attributes", JSON.stringify(READING_ATTRIBUTES));
  new Function("document", "localStorage", READING_PREFERENCES_SCRIPT)(
    { currentScript: script, documentElement: document.documentElement },
    window.localStorage,
  );
};

describe("reading preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
    applyReadingPreferences(DEFAULT_READING_PREFERENCES);
  });
  afterEach(cleanup);

  it("retains valid fields and rejects malformed or unsupported values", () => {
    for (const value of [null, "bad json", "null", "[]", "true"]) {
      expect(parseReadingPreferences(value)).toEqual(DEFAULT_READING_PREFERENCES);
    }
    expect(
      parseReadingPreferences(
        JSON.stringify({ ...saved, font: ["comic"], palette: "unknown" }),
      ),
    ).toEqual({ ...saved, font: "default", palette: "default" });
  });

  it("keeps server markup stable without overwriting saved settings on mount", () => {
    const serialized = JSON.stringify(saved);
    window.localStorage.setItem(READING_PREFERENCES_STORAGE_KEY, serialized);
    expect(
      renderToString(
        <ReadingPreferencesProvider>
          <Probe />
        </ReadingPreferencesProvider>,
      ),
    ).toBe("<span>default</span>");
    const hook = renderPreferences();
    expect(hook.result.current.preferences).toEqual(saved);
    expect(window.localStorage.getItem(READING_PREFERENCES_STORAGE_KEY)).toBe(
      serialized,
    );
  });

  it("synchronizes mounted settings and persists a reset", () => {
    let second!: ReturnType<typeof useReadingPreferences>;
    const Second = () => {
      second = useReadingPreferences();
      return null;
    };
    const first = renderHook(() => useReadingPreferences(), {
      wrapper: ({ children }) => (
        <ReadingPreferencesProvider>
          {children}
          <Second />
        </ReadingPreferencesProvider>
      ),
    });
    act(() => first.result.current.updatePreferences(saved));
    expect(second.preferences).toEqual(saved);
    expect(
      parseReadingPreferences(
        window.localStorage.getItem(READING_PREFERENCES_STORAGE_KEY),
      ),
    ).toEqual(saved);
    act(() => second.updatePreferences(DEFAULT_READING_PREFERENCES));
    expect(first.result.current.preferences).toEqual(DEFAULT_READING_PREFERENCES);
  });

  it("restores defaults when storage is cleared in another tab", () => {
    const hook = renderPreferences();
    act(() => hook.result.current.updatePreferences(saved));
    act(() => {
      window.localStorage.clear();
      window.dispatchEvent(new window.StorageEvent("storage", { key: null }));
    });
    expect(hook.result.current.preferences).toEqual(DEFAULT_READING_PREFERENCES);
  });

  it("keeps inaccessible-storage changes temporary and synchronizes a successful retry", () => {
    let second!: ReturnType<typeof useReadingPreferences>;
    const Second = () => {
      second = useReadingPreferences();
      return null;
    };
    const first = renderHook(() => useReadingPreferences(), {
      wrapper: ({ children }) => (
        <ReadingPreferencesProvider>
          {children}
          <Second />
        </ReadingPreferencesProvider>
      ),
    });
    const write = spyOn(
      Object.getPrototypeOf(window.localStorage),
      "setItem",
    ).mockImplementation(() => {
      throw new Error("Storage is full");
    });
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      act(() => first.result.current.updatePreferences(saved));
      expect(first.result.current.isPersisted).toBe(false);
      expect(second.isPersisted).toBe(false);
      expect(second.preferences).toEqual(saved);
      expect(window.localStorage.getItem(READING_PREFERENCES_STORAGE_KEY)).toBeNull();
    } finally {
      write.mockRestore();
      warn.mockRestore();
    }
    act(() => second.updatePreferences(saved));
    expect(first.result.current.isPersisted).toBe(true);
    expect(second.isPersisted).toBe(true);
    expect(
      parseReadingPreferences(
        window.localStorage.getItem(READING_PREFERENCES_STORAGE_KEY),
      ),
    ).toEqual(saved);
  });

  it("retains temporary values and retry feedback when a settings panel remounts", () => {
    let current!: ReturnType<typeof useReadingPreferences>;
    const Capture = () => {
      current = useReadingPreferences();
      return null;
    };
    const view = render(
      <ReadingPreferencesProvider>
        <Capture />
      </ReadingPreferencesProvider>,
    );
    const write = spyOn(
      Object.getPrototypeOf(window.localStorage),
      "setItem",
    ).mockImplementation(() => {
      throw new Error("Storage is full");
    });
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      act(() => current.updatePreferences(saved));
      view.rerender(
        <ReadingPreferencesProvider>
          <span>Settings closed</span>
        </ReadingPreferencesProvider>,
      );
      view.rerender(
        <ReadingPreferencesProvider>
          <Capture />
        </ReadingPreferencesProvider>,
      );
      expect(current.preferences).toEqual(saved);
      expect(current.isPersisted).toBe(false);
    } finally {
      write.mockRestore();
      warn.mockRestore();
    }
    act(() => current.updatePreferences(current.preferences));
    expect(current.isPersisted).toBe(true);
    expect(
      parseReadingPreferences(
        window.localStorage.getItem(READING_PREFERENCES_STORAGE_KEY),
      ),
    ).toEqual(saved);
  });

  it("applies the same allowlisted attributes before paint and after hydration", () => {
    window.localStorage.setItem(READING_PREFERENCES_STORAGE_KEY, JSON.stringify(saved));
    runHeadScript();
    const before = { ...document.documentElement.dataset };
    const hook = renderPreferences();
    expect({ ...document.documentElement.dataset }).toEqual(before);
    act(() => hook.result.current.updatePreferences(DEFAULT_READING_PREFERENCES));
    for (const attribute of Object.values(READING_ATTRIBUTES)) {
      expect(document.documentElement.hasAttribute(attribute)).toBe(false);
    }
    window.localStorage.setItem(
      READING_PREFERENCES_STORAGE_KEY,
      '{"font":"invalid","palette":["cream"]}',
    );
    runHeadScript();
    for (const attribute of Object.values(READING_ATTRIBUTES)) {
      expect(document.documentElement.hasAttribute(attribute)).toBe(false);
    }
  });
});
