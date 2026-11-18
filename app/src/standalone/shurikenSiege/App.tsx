import { ExternalLink } from "lucide-react";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import {
  ID_ANIMATION_HIT,
  ID_ANIMATION_SMOKE,
  IMG_LOGO_FULL,
  SHURIKEN_SIEGE_LOGO_URL,
  TD_SFX,
  TD_STAGE_IMAGE_URLS,
  type TdSfx,
} from "@/drizzle/constants";
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
  const run = useShurikenSiegeRun();
  const [splash, setSplash] = useState(true);
  const [sfxOn, setSfxOn] = useState(() => safeLocalStorageGetItem(SFX_KEY) !== "off");

  useEffect(() => {
    void portal.init().then(() => portal.loadingFinished());
    const timer = setTimeout(() => setSplash(false), SPLASH_MS);
    return () => clearTimeout(timer);
  }, [portal]);

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
    if (sfxOn && sounds.size > 0) void preloadAudioBuffers([...sounds.values()]);
  }, [sfxOn, sounds]);
  const playSound = (cue: TdSfx, volume: number) => {
    const url = sounds.get(cue);
    if (sfxOn && url) void playPreloadedAudio(url, savedSfxVolume() * volume);
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

  if (splash) return <Splash onSkip={() => setSplash(false)} />;

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
          isStarting={run.isStarting}
          isResuming={run.isResuming}
          isPurchasing={false}
          onStart={(startWave, replaceSaved) => {
            unlockAudioPlayback();
            // The break between runs is where a portal may show an ad.
            void portal
              .commercialBreak()
              .then(() => run.start(startWave, replaceSaved));
          }}
          onResume={() => {
            unlockAudioPlayback();
            run.resume();
          }}
          onDiscard={run.discardSaved}
          onBuy={run.buyDojo}
        />
        {siteLink && <FullGameInvite link={siteLink} />}
        <Toaster />
      </Screen>
    );

  return (
    <div className="h-dvh overflow-hidden">
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
          sfxOn={sfxOn}
          onSound={setSound}
          playSound={playSound}
          isGuest={false}
          standalone
          resultsFooter={siteLink && <FullGameInvite link={siteLink} compact />}
        />
      </Suspense>
      <Toaster />
    </div>
  );
};

/** The title over the dawn arena, with TheNinja-RPG credited as its maker. */
const Splash = (props: { onSkip: () => void }) => (
  <button
    type="button"
    onClick={props.onSkip}
    className="relative flex h-dvh w-full cursor-pointer flex-col items-center justify-center gap-6 overflow-hidden bg-slate-900 p-6"
  >
    <img
      src={transformImageUrl(TD_STAGE_IMAGE_URLS.Dawn)}
      alt=""
      className="absolute inset-0 h-full w-full object-cover opacity-70"
    />
    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-black/70" />
    <img
      src={transformImageUrl(SHURIKEN_SIEGE_LOGO_URL)}
      alt="Shuriken Siege"
      className="animate-in fade-in zoom-in-95 relative w-[min(88vw,46rem)] drop-shadow-2xl duration-700"
    />
    <div className="animate-in fade-in relative flex flex-col items-center gap-2 delay-300 duration-700">
      <span className="text-sm font-semibold tracking-widest text-white/90 uppercase">
        A game by
      </span>
      <img
        src={transformImageUrl(IMG_LOGO_FULL)}
        alt="TheNinja-RPG"
        className="h-14 w-auto drop-shadow-lg sm:h-16"
      />
    </div>
    <span className="relative mt-4 animate-pulse text-sm text-white/80">
      <Loader explanation="Tap to enter the Guard Hall" noPadding />
    </span>
  </button>
);

/** The lobby's page: centred, scrolling, with room for the logo above the Guard Hall. */
const Screen = (props: { children: ReactNode }) => (
  <div className="bg-background h-dvh overflow-y-auto">
    <main className="mx-auto max-w-3xl space-y-4 p-3 sm:p-5">{props.children}</main>
  </div>
);

/** TheNinja-RPG credited as the maker, linked where the build may link. */
const Credit = (props: { link: string | null }) => {
  const credit = (
    <span className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">by</span>
      <img
        src={transformImageUrl(IMG_LOGO_FULL)}
        alt="TheNinja-RPG"
        className="h-8 w-auto"
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
        src={transformImageUrl(IMG_LOGO_FULL)}
        alt=""
        className="h-10 w-auto shrink-0"
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
