import type { ShurikenSiegeBuild } from "@/standalone/shurikenSiege/build";
import { holdAudioPlayback } from "@/utils/audio";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

/** Where the player's progress is kept: the device, or the host's own cloud save. */
export interface ShurikenSiegeStore {
  /** The saved progress, or null for none; rejects when it could not be read. */
  read: () => Promise<string | null>;
  /** Save progress; resolves false when it was not kept. */
  write: (value: string) => Promise<boolean>;
  /** Whether unfinished runs may be kept on the device to resume after a reload. */
  saveRuns: boolean;
}

/**
 * What the game tells the page hosting it, and hears back: when loading ends, when play
 * starts and stops, natural breaks for ads, the best score, and the host pausing the game
 * or muting it. Builds without a portal SDK do nothing and keep progress on the device.
 */
export interface ShurikenSiegePortal {
  /** Start the portal's SDK; resolves once it is ready or known to be unavailable. */
  init: () => Promise<void>;
  /** The game is ready to play: the splash has given way to the Guard Hall. Sent once. */
  loadingFinished: () => void;
  gameplayStart: () => void;
  gameplayStop: () => void;
  /** A break before a run; resolves once any ad has finished, with game audio held. */
  commercialBreak: () => Promise<void>;
  /** The player's best wave, for hosts that show a score. */
  sendScore: (value: number) => void;
  /** Called with true when the host pauses the game and false when it resumes it. */
  onHostPause: (listener: (paused: boolean) => void) => () => void;
  /** The host's own audio setting, which overrides the game's; null without one. */
  hostAudio: () => boolean | null;
  onHostAudio: (listener: (enabled: boolean) => void) => () => void;
  /** The host owns mute and the frame, so the game shows neither control. */
  hostControls: boolean;
  store: ShurikenSiegeStore;
}

interface PokiSdk {
  init: () => Promise<void>;
  gameLoadingFinished: () => void;
  gameplayStart: () => void;
  gameplayStop: () => void;
  commercialBreak: (onStart?: () => void) => Promise<void>;
}

interface GameDistributionSdk {
  showAd: (type?: string) => Promise<unknown>;
}

interface YouTubePlayables {
  IN_PLAYABLES_ENV: boolean;
  game: {
    firstFrameReady: () => void;
    gameReady: () => void;
    loadData: () => Promise<string>;
    saveData: (data: string) => Promise<void>;
  };
  system: {
    isAudioEnabled: () => boolean;
    onAudioEnabledChange: (callback: (enabled: boolean) => void) => () => void;
    onPause: (callback: () => void) => () => void;
    onResume: (callback: () => void) => () => void;
  };
  engagement: { sendScore: (score: { value: number }) => Promise<void> };
  ads: { requestInterstitialAd: () => Promise<void> };
}

declare global {
  interface Window {
    PokiSDK?: PokiSdk;
    gdsdk?: GameDistributionSdk;
    ytgame?: YouTubePlayables;
  }
}

/** Event the GameDistribution page relays from its SDK's `onEvent`, with the event name. */
export const GAME_DISTRIBUTION_EVENT = "shuriken-siege:gd";
const PROGRESS_KEY = "shurikenSiege:progress";
/** How long the game waits for a portal's SDK, whose loader script fetches it later. */
const SDK_WAIT_MS = 6000;
/** Tries at reading YouTube's cloud save before the visit plays without it. */
const CLOUD_LOAD_ATTEMPTS = 3;
const CLOUD_RETRY_MS = 800;

/** The Playables SDK when the page runs inside YouTube; outside it the SDK does nothing. */
export const activePlayables = (build: ShurikenSiegeBuild) =>
  build.target === "youtube" && window.ytgame?.IN_PLAYABLES_ENV ? window.ytgame : null;

/** The SDK object once its script has defined it, or null if it never arrives. */
const waitFor = async <T>(read: () => T | undefined): Promise<T | null> => {
  const deadline = Date.now() + SDK_WAIT_MS;
  for (;;) {
    const sdk = read();
    if (sdk) return sdk;
    if (Date.now() > deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

/** Progress in the device's local storage, which also keeps unfinished runs. */
export const deviceStore: ShurikenSiegeStore = {
  read: async () => safeLocalStorageGetItem(PROGRESS_KEY),
  write: async (value) => safeLocalStorageSetItem(PROGRESS_KEY, value),
  saveRuns: true,
};

/**
 * YouTube's cloud save: the only place a Playable may keep progress. A read that fails is
 * tried again, and no write goes out until a read has succeeded, so a save the game never
 * saw is not overwritten.
 */
const playablesStore = (yt: YouTubePlayables): ShurikenSiegeStore => {
  let loaded: Promise<string | null> | null = null;
  const load = async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        const data = await yt.game.loadData();
        return data || null;
      } catch (error) {
        if (attempt >= CLOUD_LOAD_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, CLOUD_RETRY_MS * attempt));
      }
    }
  };
  const read = () => {
    loaded ??= load().catch((error: unknown) => {
      // A later read tries again rather than treating the failure as an empty save.
      loaded = null;
      throw error;
    });
    return loaded;
  };
  return {
    read,
    write: async (value) => {
      const isLoaded = await read().then(
        () => true,
        () => false,
      );
      if (!isLoaded) return false;
      const isSaved = await yt.game.saveData(value).then(
        () => true,
        () => false,
      );
      if (isSaved) loaded = Promise.resolve(value);
      return isSaved;
    },
    saveRuns: false,
  };
};

/**
 * The portal adapter for a build. Each SDK is used only once it has loaded and started;
 * a missing or refused SDK (an ad blocker) leaves the game playing without it.
 */
export const createPortal = (build: ShurikenSiegeBuild): ShurikenSiegePortal => {
  const target = build.target;
  const pauseListeners = new Set<(paused: boolean) => void>();
  const audioListeners = new Set<(enabled: boolean) => void>();
  const pauseHost = (paused: boolean) => {
    for (const listener of pauseListeners) listener(paused);
  };
  let poki: PokiSdk | null = null;
  let gd: GameDistributionSdk | null = null;
  // The Playables SDK is loaded before the game.
  const yt = activePlayables(build);
  // Portals reject repeated start or stop events, so only changes are reported.
  let playing = false;
  let announced = false;

  const setup = async () => {
    if (target === "poki") {
      const sdk = await waitFor(() => window.PokiSDK);
      if (sdk && (await succeeds(sdk.init()))) poki = sdk;
    } else if (target === "gamedistribution") {
      // Its SDK pauses the game around every ad, including the one before a run.
      window.addEventListener(GAME_DISTRIBUTION_EVENT, (event) => {
        const name = (event as CustomEvent<string>).detail;
        if (name === "SDK_GAME_PAUSE") {
          holdAudioPlayback("ad", true);
          pauseHost(true);
        } else if (name === "SDK_GAME_START") {
          holdAudioPlayback("ad", false);
          pauseHost(false);
        }
      });
      gd = await waitFor(() => (window.gdsdk?.showAd ? window.gdsdk : undefined));
    } else if (yt) {
      yt.system.onPause(() => {
        holdAudioPlayback("host", true);
        pauseHost(true);
      });
      yt.system.onResume(() => {
        holdAudioPlayback("host", false);
        pauseHost(false);
      });
      // YouTube's mute also silences sounds already playing.
      holdAudioPlayback("muted", !yt.system.isAudioEnabled());
      yt.system.onAudioEnabledChange((enabled) => {
        holdAudioPlayback("muted", !enabled);
        for (const listener of audioListeners) listener(enabled);
      });
    }
  };
  let initialized: Promise<void> | null = null;
  const init = () => {
    initialized ??= setup();
    return initialized;
  };

  const commercialBreak = async () => {
    // The first run waits for the SDK, so its break is not skipped.
    await init();
    if (poki) {
      await poki
        .commercialBreak(() => holdAudioPlayback("ad", true))
        .catch(() => undefined)
        .finally(() => holdAudioPlayback("ad", false));
    } else if (gd) {
      await gd.showAd().catch(() => undefined);
    } else if (yt) {
      holdAudioPlayback("ad", true);
      await yt.ads
        .requestInterstitialAd()
        .catch(() => undefined)
        .finally(() => holdAudioPlayback("ad", false));
    }
  };

  return {
    init,
    loadingFinished: () => {
      if (announced) return;
      announced = true;
      poki?.gameLoadingFinished();
      yt?.game.gameReady();
    },
    gameplayStart: () => {
      if (playing || !poki) return;
      playing = true;
      poki.gameplayStart();
    },
    gameplayStop: () => {
      if (!playing) return;
      playing = false;
      poki?.gameplayStop();
    },
    commercialBreak,
    sendScore: (value) => {
      void yt?.engagement
        .sendScore({ value: Math.floor(value) })
        .catch(() => undefined);
    },
    onHostPause: (listener) => {
      pauseListeners.add(listener);
      return () => pauseListeners.delete(listener);
    },
    hostAudio: () => (yt ? yt.system.isAudioEnabled() : null),
    onHostAudio: (listener) => {
      audioListeners.add(listener);
      return () => audioListeners.delete(listener);
    },
    hostControls: yt !== null,
    store: yt ? playablesStore(yt) : deviceStore,
  };
};

const succeeds = (promise: Promise<unknown>) =>
  promise.then(
    () => true,
    () => false,
  );
