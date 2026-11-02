import { afterEach, describe, expect, it } from "bun:test";
import { getEffectiveColorTheme } from "@/libs/themePreference";
import { ensureDom } from "../setup/dom.mjs";

ensureDom();

describe("getEffectiveColorTheme", () => {
  afterEach(() => {
    localStorage.removeItem("theme");
    document.documentElement.classList.remove("dark");
  });

  it("uses the tone of layouts without color mode over the saved theme", () => {
    localStorage.setItem("theme", "light");
    expect(getEffectiveColorTheme("pixel")).toBe("dark");
    expect(getEffectiveColorTheme("20-eclipse-observatory")).toBe("dark");
    expect(getEffectiveColorTheme("17-obsidian-council")).toBe("dark");
    localStorage.setItem("theme", "dark");
    expect(getEffectiveColorTheme("3-sakura-courtyard")).toBe("light");
  });

  it("uses the saved theme on color-mode layouts", () => {
    expect(getEffectiveColorTheme("default")).toBe("light");
    localStorage.setItem("theme", "dark");
    expect(getEffectiveColorTheme("default")).toBe("dark");
  });

  it("follows the document class without a layout", () => {
    localStorage.setItem("theme", "light");
    document.documentElement.classList.add("dark");
    expect(getEffectiveColorTheme()).toBe("dark");
    localStorage.setItem("theme", "dark");
    document.documentElement.classList.remove("dark");
    expect(getEffectiveColorTheme()).toBe("light");
  });
});
