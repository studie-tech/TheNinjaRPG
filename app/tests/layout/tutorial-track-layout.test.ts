import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { trackLayout } from "@/layout/TutorialAssistant";
import { installBrowserGlobals, restoreBrowserGlobals } from "../setup/browserGlobals";

let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  installBrowserGlobals({ resizeObserver: true, animationFrame: true });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  document.body.replaceChildren();
  restoreBrowserGlobals();
  vi.useRealTimers();
});

/** Let MutationObserver callbacks run, then the frame they schedule. */
const flushMutations = async () => {
  await Promise.resolve();
  vi.advanceTimersByTime(0);
};

describe("tutorial highlight layout tracking", () => {
  it("measures once per frame however many mutations arrive", async () => {
    const target = document.body.appendChild(document.createElement("div"));
    const update = vi.fn(() => target);
    stop = trackLayout(update);
    expect(update).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 5; i++)
      document.body.appendChild(document.createElement("span"));
    await flushMutations();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("ignores attribute changes", async () => {
    const target = document.body.appendChild(document.createElement("div"));
    const update = vi.fn(() => target);
    stop = trackLayout(update);
    target.setAttribute("data-state", "open");
    await flushMutations();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("stops polling once the target holds still and resumes on the next change", async () => {
    const target = document.body.appendChild(document.createElement("div"));
    const update = vi.fn(() => target);
    stop = trackLayout(update);
    vi.advanceTimersByTime(250 * 4);
    const settled = update.mock.calls.length;
    vi.advanceTimersByTime(250 * 8);
    expect(update).toHaveBeenCalledTimes(settled);
    document.body.appendChild(document.createElement("span"));
    await flushMutations();
    vi.advanceTimersByTime(250);
    expect(update.mock.calls.length).toBeGreaterThan(settled + 1);
  });

  it("keeps polling while the target has not mounted", () => {
    const update = vi.fn(() => null);
    stop = trackLayout(update);
    vi.advanceTimersByTime(250 * 10);
    expect(update).toHaveBeenCalledTimes(11);
  });
});
