import type { ShurikenSiegeBuild } from "@/standalone/shurikenSiege/build";
import { holdAudioPlayback } from "@/utils/audio";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

/** Where the player's progress is kept: the device, or the host's own cloud save. */
export interface ShurikenSiegeStore {
  read: () => Promise<string | null>;
  write: (value: string) => Promise<void>;
  /** Whether unfinished runs may be kept on the device to resume after a reload. */
  saveRuns: boolean;
}

/**
 * What the game tells the page hosting it, and hears back: when loading ends, when play
 * starts and stops, natural breaks for ads, the best score, and the host pausing the game
 * or muting it. Builds without a portal SDK do nothing and keep progress on the device.
 */
export interface ShurikenSiegePortal {
  init: () => Promise<void>;
  /** The game is ready to play: the splash has given way to the Guard Hall. */
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

interface CrazyGamesSdk {
  init: () => Promise<void>;
  game: {
    loadingStop: () => void;
    gameplayStart: () => void;
    gameplayStop: () => void;
  };
  ad: {
    requestAd: (
      type: "midgame",
      callbacks: { adStarted: () => void; adFinished: () => void; adError: () => void },
    ) => void;
  };
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
    CrazyGames?: { SDK: CrazyGamesSdk };
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
  write: async (value) => {
    safeLocalStorageSetItem(PROGRESS_KEY, value);
  },
  saveRuns: true,
};

/**
 * YouTube's cloud save: the only place a Playable may keep progress. The first read waits
 * for its data, and no write goes out before that read has finished.
 */
const playablesStore = (yt: YouTubePlayables): ShurikenSiegeStore => {
  let loaded: Promise<string | null> | null = null;
  let latest: string | null = null;
  const read = () => {
    loaded ??= yt.game.loadData().then(
      (data) => {
        latest = data || null;
        return latest;
      },
      () => null,
    );
    return loaded.then(() => latest);
  };
  return {
    read,
    write: async (value) => {
      await read();
      latest = value;
      await yt.game.saveData(value).catch(() => undefined);
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
  let crazy: CrazyGamesSdk | null = null;
  let poki: PokiSdk | null = null;
  let gd: GameDistributionSdk | null = null;
  // The Playables SDK is loaded before the game; it is a no-op outside YouTube.
  const yt =
    target === "youtube" && window.ytgame?.IN_PLAYABLES_ENV ? window.ytgame : null;
  // Portals reject repeated start or stop events, so only changes are reported.
  let playing = false;

  const init = async () => {
    if (target === "crazygames") {
      const sdk = await waitFor(() => window.CrazyGames?.SDK);
      if (sdk && (await succeeds(sdk.init()))) crazy = sdk;
    } else if (target === "poki") {
      const sdk = await waitFor(() => window.PokiSDK);
      if (sdk && (await succeeds(sdk.init()))) poki = sdk;
    } else if (target === "gamedistribution") {
      // Its SDK pauses the game around every ad, including the one before a run.
      window.addEventListener(GAME_DISTRIBUTION_EVENT, (event) => {
        const name = (event as CustomEvent<string>).detail;
        if (name === "SDK_GAME_PAUSE") {
          holdAudioPlayback(true);
          pauseHost(true);
        } else if (name === "SDK_GAME_START") {
          holdAudioPlayback(false);
          pauseHost(false);
        }
      });
      gd = await waitFor(() => (window.gdsdk?.showAd ? window.gdsdk : undefined));
    } else if (yt) {
      // The splash is on screen, telling the player the game is loading.
      yt.game.firstFrameReady();
      yt.system.onPause(() => {
        holdAudioPlayback(true);
        pauseHost(true);
      });
      yt.system.onResume(() => {
        holdAudioPlayback(false);
        pauseHost(false);
      });
      yt.system.onAudioEnabledChange((enabled) => {
        for (const listener of audioListeners) listener(enabled);
      });
    }
  };

  const commercialBreak = async () => {
    if (crazy) {
      const sdk = crazy;
      await new Promise<void>((resolve) => {
        const done = () => {
          holdAudioPlayback(false);
          resolve();
        };
        sdk.ad.requestAd("midgame", {
          adStarted: () => holdAudioPlayback(true),
          adFinished: done,
          adError: done,
        });
      });
    } else if (poki) {
      await poki
        .commercialBreak(() => holdAudioPlayback(true))
        .catch(() => undefined)
        .finally(() => holdAudioPlayback(false));
    } else if (gd) {
      await gd.showAd().catch(() => undefined);
    } else if (yt) {
      holdAudioPlayback(true);
      await yt.ads
        .requestInterstitialAd()
        .catch(() => undefined)
        .finally(() => holdAudioPlayback(false));
    }
  };

  return {
    init,
    loadingFinished: () => {
      crazy?.game.loadingStop();
      poki?.gameLoadingFinished();
      yt?.game.gameReady();
    },
    gameplayStart: () => {
      if (playing || (!crazy && !poki)) return;
      playing = true;
      crazy?.game.gameplayStart();
      poki?.gameplayStart();
    },
    gameplayStop: () => {
      if (!playing) return;
      playing = false;
      crazy?.game.gameplayStop();
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
    hostControls: target === "youtube",
    store: yt ? playablesStore(yt) : deviceStore,
  };
};

const succeeds = (promise: Promise<unknown>) =>
  promise.then(
    () => true,
    () => false,
  );
