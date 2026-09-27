import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAudio } from "@/hooks/useAudio";
import { ensureDom } from "../setup-dom.mjs";

vi.mock("@/utils/audio", () => ({
  isSafariOrIOS: () => true,
  addUserInteractionListeners: () => () => undefined,
}));

ensureDom();

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useAudio", () => {
  it("releases the media source when music is off and restores it when on", () => {
    const elements: HTMLAudioElement[] = [];
    vi.stubGlobal("Audio", function () {
      const element = document.createElement("audio");
      element.pause = vi.fn();
      element.load = vi.fn();
      elements.push(element);
      return element;
    });

    const { rerender } = renderHook(
      ({ src }) => useAudio({ src, enabled: false, autoPlay: false }),
      { initialProps: { src: "/music.mp3" } },
    );
    expect(elements[0]?.getAttribute("src")).toBe("/music.mp3");

    rerender({ src: "" });
    expect(elements[0]?.hasAttribute("src")).toBe(false);
    expect(elements[0]?.load).toHaveBeenCalled();

    rerender({ src: "/music.mp3" });
    expect(elements[1]?.getAttribute("src")).toBe("/music.mp3");
  });
});
