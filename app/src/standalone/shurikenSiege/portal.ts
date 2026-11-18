import type { ShurikenSiegeBuild } from "@/standalone/shurikenSiege/build";
import { holdAudioPlayback } from "@/utils/audio";

/**
 * What the game tells the portal hosting it: when loading ends, when play starts and
 * stops, and when a natural break allows an ad. Builds without a portal SDK do nothing.
 */
export interface ShurikenSiegePortal {
  init: () => Promise<void>;
  loadingFinished: () => void;
  gameplayStart: () => void;
  gameplayStop: () => void;
  /** A break between runs; resolves once any ad has finished, with game audio held. */
  commercialBreak: () => Promise<void>;
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

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazyGamesSdk };
    PokiSDK?: PokiSdk;
  }
}

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

/**
 * The portal adapter for a build. Each SDK is used only once it has loaded and started;
 * a missing or refused SDK (an ad blocker) leaves the game playing without it.
 */
export const createPortal = (build: ShurikenSiegeBuild): ShurikenSiegePortal => {
  const target = build.target;
  let crazy: CrazyGamesSdk | null = null;
  let poki: PokiSdk | null = null;
  // Portals reject repeated start or stop events, so only changes are reported.
  let playing = false;

  const init = async () => {
    if (target === "crazygames") {
      const sdk = await waitFor(() => window.CrazyGames?.SDK);
      if (
        sdk &&
        (await sdk.init().then(
          () => true,
          () => false,
        ))
      )
        crazy = sdk;
    } else if (target === "poki") {
      const sdk = await waitFor(() => window.PokiSDK);
      if (
        sdk &&
        (await sdk.init().then(
          () => true,
          () => false,
        ))
      )
        poki = sdk;
    }
  };

  /** Run an ad between runs, holding the game's audio while it plays. */
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
    }
  };

  return {
    init,
    loadingFinished: () => {
      crazy?.game.loadingStop();
      poki?.gameLoadingFinished();
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
  };
};
