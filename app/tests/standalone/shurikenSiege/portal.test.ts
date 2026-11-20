import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { ShurikenSiegeBuild } from "@/standalone/shurikenSiege/build";
import { createPortal } from "@/standalone/shurikenSiege/portal";
import {
  installBrowserGlobals,
  restoreBrowserGlobals,
} from "../../setup/browserGlobals";

beforeEach(() => {
  installBrowserGlobals();
});

afterEach(() => {
  Reflect.deleteProperty(window, "PokiSDK");
  Reflect.deleteProperty(window, "ytgame");
  restoreBrowserGlobals();
});

const build = (target: ShurikenSiegeBuild["target"]): ShurikenSiegeBuild => ({
  target,
  links: false,
  source: target,
  version: "test",
});

const fakePoki = (init: () => Promise<void>) => ({
  init: vi.fn(init),
  gameLoadingFinished: vi.fn(),
  gameplayStart: vi.fn(),
  gameplayStop: vi.fn(),
  commercialBreak: vi.fn(async () => {}),
});

const fakePlayables = (loadData: () => Promise<string>) => ({
  IN_PLAYABLES_ENV: true,
  game: {
    firstFrameReady: vi.fn(),
    gameReady: vi.fn(),
    loadData: vi.fn(loadData),
    saveData: vi.fn(async () => {}),
  },
  system: {
    isAudioEnabled: () => true,
    onAudioEnabledChange: () => () => {},
    onPause: () => () => {},
    onResume: () => () => {},
  },
  engagement: { sendScore: vi.fn(async () => {}) },
  ads: { requestInterstitialAd: vi.fn(async () => {}) },
});

describe("Shuriken Siege portal adapter", () => {
  it("plays without a Poki SDK whose init never settles", async () => {
    const poki = fakePoki(() => new Promise(() => {}));
    Object.assign(window, { PokiSDK: poki });
    const portal = createPortal(build("poki"), { sdkWaitMs: 50 });
    await portal.init();
    portal.loadingFinished();
    await portal.commercialBreak();
    portal.gameplayStart();
    expect(poki.init).toHaveBeenCalledTimes(1);
    expect(poki.gameLoadingFinished).not.toHaveBeenCalled();
    expect(poki.commercialBreak).not.toHaveBeenCalled();
    expect(poki.gameplayStart).not.toHaveBeenCalled();
  });

  it("reports loading finished to a started Poki SDK once", async () => {
    const poki = fakePoki(async () => {});
    Object.assign(window, { PokiSDK: poki });
    const portal = createPortal(build("poki"), { sdkWaitMs: 50 });
    await portal.init();
    portal.loadingFinished();
    portal.loadingFinished();
    await portal.commercialBreak();
    expect(poki.gameLoadingFinished).toHaveBeenCalledTimes(1);
    expect(poki.commercialBreak).toHaveBeenCalledTimes(1);
  });

  it("retries a failed cloud load and reads the cloud save afresh each time", async () => {
    let calls = 0;
    const saves = ["", '{"points":5}', '{"points":9}'];
    const yt = fakePlayables(async () => {
      calls++;
      if (calls === 1) throw new Error("offline");
      return saves[Math.min(calls - 1, saves.length - 1)] ?? "";
    });
    Object.assign(window, { ytgame: yt });
    const portal = createPortal(build("youtube"));
    expect(portal.hostControls).toBe(true);
    expect(await portal.store.read()).toBe('{"points":5}');
    // Another tab saved since; the next read sees it.
    expect(await portal.store.read()).toBe('{"points":9}');
    expect(await portal.store.write('{"points":10}')).toBe(true);
    expect(yt.game.saveData).toHaveBeenCalledWith('{"points":10}');
  });

  it("never writes a cloud save it could not read", async () => {
    const yt = fakePlayables(async () => {
      throw new Error("offline");
    });
    Object.assign(window, { ytgame: yt });
    const portal = createPortal(build("youtube"));
    expect(await portal.store.write('{"points":1}')).toBe(false);
    expect(yt.game.saveData).not.toHaveBeenCalled();
  });

  it("keeps the game's own controls when the YouTube build runs outside Playables", () => {
    const portal = createPortal(build("youtube"));
    expect(portal.hostControls).toBe(false);
    expect(portal.hostAudio()).toBeNull();
  });
});
