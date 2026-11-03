import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { ignoreToastInteractions } from "@/components/ui/outside-interaction";

const outsideEvent = (target: EventTarget | null) => ({
  target,
  preventDefault: vi.fn(),
});

describe("ignoreToastInteractions", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <section data-sonner-toaster="true"><li data-sonner-toast><button id="dismiss">OK</button></li></section>
      <main><button id="page">Page</button></main>`;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps the dialog open for presses inside a toast", () => {
    const handler = vi.fn();
    const event = outsideEvent(document.getElementById("dismiss"));
    ignoreToastInteractions(handler)(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes every other outside interaction to the caller's handler", () => {
    const handler = vi.fn();
    const event = outsideEvent(document.getElementById("page"));
    ignoreToastInteractions(handler)(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it("leaves the default dismissal alone without a caller handler", () => {
    const event = outsideEvent(document.getElementById("page"));
    ignoreToastInteractions()(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
