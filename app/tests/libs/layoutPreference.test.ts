import { afterEach, describe, expect, it } from "bun:test";
import { applyFontScaleCookie, FONT_SCALE_COOKIE } from "@/libs/layoutPreference";

const clearCookie = (name: string) => {
  // biome-ignore lint/suspicious/noDocumentCookie: the cookie is the input under test.
  document.cookie = `${name}=; max-age=0; path=/`;
};
const applied = () => document.documentElement.style.getPropertyValue("--font-scale");

afterEach(() => {
  clearCookie(FONT_SCALE_COOKIE);
  clearCookie("other");
  document.documentElement.style.removeProperty("--font-scale");
});

describe("applyFontScaleCookie", () => {
  it("applies a supported scale, wherever the cookie sits", () => {
    document.cookie = "other=1; path=/";
    document.cookie = `${FONT_SCALE_COOKIE}=1.15; path=/`;
    applyFontScaleCookie();
    expect(applied()).toBe("1.15");
  });

  it("does not take a longer cookie name for the scale", () => {
    document.cookie = `x_${FONT_SCALE_COOKIE}=1.3; path=/`;
    applyFontScaleCookie();
    expect(applied()).toBe("");
    clearCookie(`x_${FONT_SCALE_COOKIE}`);
  });

  it.each([["1"], ["2"], [""]])("clears the property for %p", (value) => {
    document.documentElement.style.setProperty("--font-scale", "1.3");
    document.cookie = `${FONT_SCALE_COOKIE}=${value}; path=/`;
    applyFontScaleCookie();
    expect(applied()).toBe("");
  });

  it("clears the property without a cookie", () => {
    document.documentElement.style.setProperty("--font-scale", "1.3");
    applyFontScaleCookie();
    expect(applied()).toBe("");
  });
});
