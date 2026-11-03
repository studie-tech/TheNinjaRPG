import { describe, expect, it } from "bun:test";
import { IframeMuteObserver } from "@/utils/audio";

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
    const observer = new IframeMuteObserver();
    observer.start(true);
    observer.start(true);
    observer.stop();

    const iframe = await appendUserIframe();
    expect(new URL(iframe.src).searchParams.get("mute")).toBe("1");

    observer.stop();
    const later = await appendUserIframe();
    expect(new URL(later.src).searchParams.get("mute")).toBeNull();
  });
});
