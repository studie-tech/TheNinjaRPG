import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { cleanup, renderHook } from "@testing-library/react";
import { editorTitle, useEditorTitle } from "@/hooks/useEditorTitle";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

describe("content editor titles", () => {
  beforeEach(() => {
    installBrowserGlobals();
    document.title = "Edit Jutsu | TheNinja-RPG";
  });
  afterEach(() => {
    cleanup();
    restoreBrowserGlobals();
  });

  it("names the entry and falls back to the type while the name is empty", () => {
    expect(editorTitle("jutsu", " Fireball ")).toBe("Edit jutsu: Fireball");
    expect(editorTitle("jutsu", "")).toBe("Edit jutsu");
    expect(editorTitle("jutsu", undefined)).toBe("Edit jutsu");
  });

  it("follows the edited name in the browser tab and restores it on unmount", () => {
    const { result, rerender, unmount } = renderHook(
      ({ name }) => useEditorTitle("jutsu", name),
      { initialProps: { name: "Fireball" } },
    );
    expect(result.current).toBe("Edit jutsu: Fireball");
    expect(document.title).toBe("Edit jutsu: Fireball");
    rerender({ name: "Water Dragon" });
    expect(document.title).toBe("Edit jutsu: Water Dragon");
    unmount();
    expect(document.title).toBe("Edit Jutsu | TheNinja-RPG");
  });
});
