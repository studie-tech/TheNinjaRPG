import { ExternalLink, RotateCw } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";
import {
  ID_ANIMATION_HIT,
  ID_ANIMATION_SMOKE,
  IMG_LOGO_SHORT,
  SHURIKEN_SIEGE_LOGO_URL,
  TD_SFX,
  TD_STAGE_IMAGE_URLS,
  type TdSfx,
} from "@/drizzle/constants";
import { ChunkErrorBoundary } from "@/layout/ChunkErrorBoundary";
import Loader from "@/layout/Loader";
import { TowerDefenseLobby } from "@/layout/TowerDefenseLobby";
import { TowerDefensePlayfield } from "@/layout/TowerDefensePlayfield";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { cn } from "@/libs/shadui";
import { buildData, readBuild } from "@/standalone/shurikenSiege/build";
import { createPortal } from "@/standalone/shurikenSiege/portal";
import { useShurikenSiegeRun } from "@/standalone/shurikenSiege/useShurikenSiegeRun";
import {
  playPreloadedAudio,
  preloadAudioBuffers,
  savedSfxVolume,
  unlockAudioPlayback,
} from "@/utils/audio";
import { transformImageUrl } from "@/utils/image";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";

const TowerDefenseArena = lazy(() =>
  import("@/layout/TowerDefense").then((module) => ({
    default: module.TowerDefenseArena,
  })),
);

const SFX_KEY = "shurikenSiege:sfx";
/** The splash stays at least this long, so the title registers before the Guard Hall. */
const SPLASH_MS = 1800;
const SITE_URL = "https://www.theninja-rpg.com/";

/**
 * Shuriken Siege: TheNinja-RPG's tower defense as a standalone game. A splash introduces
 * the title, the Guard Hall spends locally banked scrolls, and runs play in a stage that
 * fills the page. Builds for portals that allow it link back to TheNinja-RPG.
 */
export const ShurikenSiegeApp = () => {
  const build = useMemo(() => readBuild(), []);
  const portal = useMemo(() => createPortal(build), [build]);
  const data = buildData();
  const run = useShurikenSiegeRun(portal.store, portal.sendScore);
  const [splashShown, setSplashShown] = useState(false);
  const [sfxOn, setSfxOn] = useState(() => safeLocalStorageGetItem(SFX_KEY) !== "off");
  const [hostAudio, setHostAudio] = useState(() => portal.hostAudio());
  const [hostPaused, setHostPaused] = useState(false);
  const [isPortalReady, setIsPortalReady] = useState(false);
  /** A commercial break before a run is showing, so Start waits for it. */
  const [isBreaking, setIsBreaking] = useState(false);
  // The Guard Hall opens once the title has shown, the player's progress has loaded and
  // the portal's SDK is ready or known to be missing.
  const splash = !splashShown || !run.isLoaded || !isPortalReady;

  useEffect(() => {
    let cancelled = false;
    void portal.init().then(() => {
      if (!cancelled) setIsPortalReady(true);
    });
    const timer = setTimeout(() => setSplashShown(true), SPLASH_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [portal]);
  // When the Guard Hall first opens, the host learns the game is ready and, if it shows a
  // score, the saved best wave; each claim reports a new best wave after that.
  const hasOpened = useRef(false);
  const { bestWave } = run.progress;
  useEffect(() => {
    if (splash || hasOpened.current) return;
    hasOpened.current = true;
    portal.loadingFinished();
    portal.sendScore(bestWave);
  }, [bestWave, portal, splash]);

  // A host pausing the game holds the run and takes its arena down until it resumes.
  const { setPaused } = run;
  useEffect(
    () =>
      portal.onHostPause((paused) => {
        setHostPaused(paused);
        setPaused("host", paused);
      }),
    [portal, setPaused],
  );
  useEffect(() => portal.onHostAudio(setHostAudio), [portal]);
  const soundOn = hostAudio ?? sfxOn;

  // Portals count play time between these events: a pause, the perk draft, the results
  // and the Guard Hall all stop it.
  const playing =
    run.phase === "playing" && !run.paused && !run.hud?.offer && !run.isResuming;
  useEffect(() => {
    if (playing) portal.gameplayStart();
    else portal.gameplayStop();
  }, [playing, portal]);

  const sounds = useMemo(() => {
    const urls = new Map<TdSfx, string>();
    for (const [cue, id] of Object.entries(TD_SFX) as [TdSfx, string][]) {
      const url = data.assets.find((asset) => asset.id === id)?.url;
      if (url) urls.set(cue, url);
    }
    return urls;
  }, [data]);
  useEffect(() => {
    if (soundOn && sounds.size > 0) void preloadAudioBuffers([...sounds.values()]);
  }, [soundOn, sounds]);
  const playSound = (cue: TdSfx, volume: number) => {
    const url = sounds.get(cue);
    if (soundOn && url) void playPreloadedAudio(url, savedSfxVolume() * volume);
  };
  const setSound = (enabled: boolean) => {
    if (enabled) unlockAudioPlayback();
    setSfxOn(enabled);
    safeLocalStorageSetItem(SFX_KEY, enabled ? "on" : "off");
  };
  const appearance = useMemo(() => resolveSpriteAppearance({ gender: "Male" }), []);
  const siteLink = build.links
    ? `${SITE_URL}?utm_source=${encodeURIComponent(build.source)}&utm_medium=game&utm_campaign=shuriken-siege`
    : null;

  if (splash) return <Splash onSkip={() => setSplashShown(true)} />;

  if (run.phase === "lobby")
    return (
      <Screen>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <img
            src={transformImageUrl(SHURIKEN_SIEGE_LOGO_URL)}
            alt="Shuriken Siege"
            className="h-16 w-auto sm:h-20"
          />
          <Credit link={siteLink} />
        </header>
        <TowerDefenseLobby
          isGuest={false}
          progress={run.progress}
          saved={run.saved}
          isStarting={run.isStarting || isBreaking}
          isResuming={run.isResuming}
          isPurchasing={false}
          onStart={(startWave, replaceSaved) => {
            if (isBreaking) return;
            unlockAudioPlayback();
            setIsBreaking(true);
            // The break between runs is where a portal may show an ad.
            void portal
              .commercialBreak()
              .then(() => run.start(startWave, replaceSaved))
              .finally(() => setIsBreaking(false));
          }}
          onResume={() => {
            unlockAudioPlayback();
            run.resume();
          }}
          onDiscard={run.discardSaved}
          onBuy={(upgradeId) => void run.buyDojo(upgradeId)}
        />
        {siteLink && <FullGameInvite link={siteLink} />}
        <Toaster />
      </Screen>
    );

  return (
    <div className="h-dvh overflow-hidden">
      <ChunkErrorBoundary fallback={() => <ArenaLoadFailed />}>
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Loader explanation="Loading arena..." />
            </div>
          }
        >
          <TowerDefensePlayfield
            run={run}
            Arena={TowerDefenseArena}
            appearance={appearance}
            roster={data.roster}
            hitAsset={data.assets.find((asset) => asset.id === ID_ANIMATION_HIT)}
            smokeAsset={data.assets.find((asset) => asset.id === ID_ANIMATION_SMOKE)}
            sfxOn={soundOn}
            onSound={portal.hostControls ? undefined : setSound}
            hostControlsFrame={portal.hostControls}
            suspended={hostPaused}
            playSound={playSound}
            isGuest={false}
            standalone
            resultsFooter={siteLink && <FullGameInvite link={siteLink} compact />}
          />
        </Suspense>
      </ChunkErrorBoundary>
      <Toaster />
    </div>
  );
};

/** The title over the dawn arena, with TheNinja-RPG credited as its maker beneath. */
const Splash = (props: { onSkip: () => void }) => (
  <button
    type="button"
    onClick={props.onSkip}
    className="relative flex h-dvh w-full cursor-pointer flex-col items-center justify-center overflow-hidden bg-slate-900 p-6"
  >
    <img
      src={transformImageUrl(TD_STAGE_IMAGE_URLS.Dawn)}
      alt=""
      className="absolute inset-0 h-full w-full object-cover opacity-70"
    />
    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-black/75" />
    <div className="relative flex flex-1 flex-col items-center justify-center gap-5">
      <img
        src={transformImageUrl(SHURIKEN_SIEGE_LOGO_URL)}
        alt="Shuriken Siege"
        className="animate-in fade-in zoom-in-95 w-[min(88vw,46rem)] drop-shadow-2xl duration-700"
      />
      <span className="animate-pulse text-base tracking-wide text-white/90 drop-shadow lg:text-xl">
        Tap to enter the Guard Hall
      </span>
    </div>
    <div className="animate-in fade-in slide-in-from-bottom-2 relative flex flex-col items-center gap-3 delay-300 duration-700">
      <span className="flex items-center gap-4 text-xs font-semibold tracking-[0.4em] text-white/80 uppercase drop-shadow lg:text-sm">
        <span className="h-px w-10 bg-gradient-to-l from-white/60 to-transparent lg:w-16" />
        A game by
        <span className="h-px w-10 bg-gradient-to-r from-white/60 to-transparent lg:w-16" />
      </span>
      <img
        src={transformImageUrl(IMG_LOGO_SHORT)}
        alt="TheNinja-RPG"
        className="h-16 w-auto drop-shadow-lg sm:h-20 lg:h-24"
      />
    </div>
  </button>
);

/**
 * The arena's code failed to download. A failed dynamic import stays failed for the
 * page, so recovering means loading the page again; the saved run resumes after it.
 */
const ArenaLoadFailed = () => (
  <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
    <p>The arena could not load. Check your connection and reload to continue.</p>
    <Button onClick={() => window.location.reload()}>
      <RotateCw className="h-5 w-5" />
      Reload
    </Button>
  </div>
);

/** The lobby's page: centred, scrolling, with room for the logo above the Guard Hall. */
const Screen = (props: { children: ReactNode }) => (
  <div className="bg-background h-dvh overflow-y-auto">
    <main className="mx-auto max-w-5xl space-y-4 p-3 sm:p-5">{props.children}</main>
  </div>
);

/** TheNinja-RPG credited as the maker, linked where the build may link. */
const Credit = (props: { link: string | null }) => {
  const credit = (
    <span className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">by</span>
      <img
        src={transformImageUrl(IMG_LOGO_SHORT)}
        alt="TheNinja-RPG"
        className="h-7 w-auto"
      />
    </span>
  );
  return props.link ? (
    <a href={props.link} target="_blank" rel="noopener" className="hover:opacity-80">
      {credit}
    </a>
  ) : (
    credit
  );
};

/** An invitation to play the full game this one comes from. */
const FullGameInvite = (props: { link: string; compact?: boolean }) => (
  <a
    href={props.link}
    target="_blank"
    rel="noopener"
    className={cn(
      "hover:bg-muted flex items-center gap-3 rounded-lg border p-3 text-left",
      props.compact && "justify-center p-2 text-sm",
    )}
  >
    {!props.compact && (
      <img
        src={transformImageUrl(IMG_LOGO_SHORT)}
        alt=""
        className="h-8 w-auto shrink-0"
      />
    )}
    <span className="min-w-0 flex-1">
      <span className="block font-semibold">
        {props.compact ? "Play the full ninja RPG" : "Enjoyed the siege?"}
      </span>
      {!props.compact && (
        <span className="text-muted-foreground block text-sm">
          Shuriken Siege comes from TheNinja-RPG, a free browser MMORPG with villages,
          jutsu, clans and ranked battles. Your Guard Hall waits there too.
        </span>
      )}
    </span>
    <ExternalLink className="h-4 w-4 shrink-0" />
  </a>
);
