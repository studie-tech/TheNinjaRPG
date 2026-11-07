import { describe, expect, it } from "bun:test";
import { observeUserIframes, setIframeMuteState } from "@/utils/audio";

const appendUserIframe = async () => {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("data-user-iframe", "");
  iframe.src = "https://www.youtube.com/embed/abc";
  document.body.appendChild(iframe);
  await new Promise((resolve) => setTimeout(resolve, 0));
  iframe.remove();
  return iframe;
};

describe("iframe mute observer", () => {
  it("keeps muting new iframes while another consumer is still mounted", async () => {
    const stopFirst = observeUserIframes(true);
    const stopSecond = observeUserIframes(true);
    stopFirst();

    const iframe = await appendUserIframe();
    expect(new URL(iframe.src).searchParams.get("mute")).toBe("1");

    stopSecond();
    const later = await appendUserIframe();
    expect(new URL(later.src).searchParams.get("mute")).toBeNull();
  });

  it("leaves existing iframes alone until a toggle, then rewrites each one once", async () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("data-user-iframe", "");
    iframe.src = "https://www.youtube.com/embed/abc";
    document.body.appendChild(iframe);
    const sources: string[] = [];
    const { get, set } = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(iframe),
      "src",
    ) as PropertyDescriptor;
    Object.defineProperty(iframe, "src", {
      configurable: true,
      get() {
        return get?.call(this);
      },
      set(value: string) {
        sources.push(value);
        set?.call(this, value);
      },
    });

    const stop = observeUserIframes(true);
    expect(sources).toEqual([]);

    setIframeMuteState(true);
    expect(sources).toEqual(["https://www.youtube.com/embed/abc?mute=1"]);
    setIframeMuteState(false);
    expect(sources).toEqual([
      "https://www.youtube.com/embed/abc?mute=1",
      "https://www.youtube.com/embed/abc",
    ]);

    stop();
    iframe.remove();
  });

  it("applies a toggle to iframes added afterwards", async () => {
    const stop = observeUserIframes(false);
    const unmuted = await appendUserIframe();
    expect(new URL(unmuted.src).searchParams.get("mute")).toBeNull();

    setIframeMuteState(true);
    const muted = await appendUserIframe();
    expect(new URL(muted.src).searchParams.get("mute")).toBe("1");

    setIframeMuteState(false);
    stop();
  });
});
