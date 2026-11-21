"use client";

import { ScrollText, Trophy } from "lucide-react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { type ReactNode, Suspense, useEffect, useMemo } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  ID_ANIMATION_HIT,
  ID_ANIMATION_SMOKE,
  TD_SFX,
  type TdSfx,
} from "@/drizzle/constants";
import { useTowerDefenseRun } from "@/hooks/useTowerDefenseRun";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import ContentBox from "@/layout/ContentBox";
import { useGameSettings } from "@/layout/GameSettings";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { TowerDefenseChallenge } from "@/layout/TowerDefenseChallenge";
import { TowerDefenseLobby } from "@/layout/TowerDefenseLobby";
import { TowerDefensePlayfield } from "@/layout/TowerDefensePlayfield";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { tdDailyDutyDone } from "@/libs/towerDefense/balance";
import { findTowerDefenseChallenge } from "@/libs/towerDefense/challenge";
import { playPreloadedAudio, preloadAudioBuffers, savedSfxVolume } from "@/utils/audio";
import { useUserDataSelector } from "@/utils/UserContext";

// Load the renderer only once a run starts
const TowerDefenseArena = dynamic(
  () => import("@/layout/TowerDefense").then((module) => module.TowerDefenseArena),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[400px] items-center justify-center">
        <Loader explanation="Loading arena..." />
      </div>
    ),
  },
);

export default function TowerDefensePage() {
  const {
    data: user,
    isClerkLoaded,
    isSignedIn,
    status,
    timeDiff,
  } = useUserDataSelector((profile) => ({
    userId: profile.userId,
    level: profile.level,
    gender: profile.gender,
    spriteBodyStyle: profile.spriteBodyStyle,
    attributes: profile.attributes,
    items: profile.items,
    // Sound follows the same "Combat sounds" preference and volume as battles.
    musicOn: profile.musicOn,
    buttonSfxOn: profile.buttonSfxOn,
    sfxOn: profile.sfxOn,
    village: profile.village,
    isOutlaw: profile.isOutlaw,
    bloodlineId: profile.bloodlineId,
    status: profile.status,
    towerDefenseDutyAt: profile.towerDefenseDutyAt,
    userQuests: profile.userQuests,
    questData: profile.questData,
    sector: profile.sector,
    longitude: profile.longitude,
    latitude: profile.latitude,
  }));
  const userId = user?.userId;
  const utils = api.useUtils();
  const run = useTowerDefenseRun(userId);
  const progress = api.towerDefense.getProgress.useQuery(undefined, {
    enabled: !!userId,
  });
  const roster = api.towerDefense.getRoster.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  });
  const { data: assets } = api.misc.getAllGameAssetNames.useQuery({
    ids: [ID_ANIMATION_HIT, ID_ANIMATION_SMOKE, ...Object.values(TD_SFX)],
  });
  const { sfxOn, setSfxEnabled } = useGameSettings(user);
  const sounds = useMemo(() => {
    const urls = new Map<TdSfx, string>();
    for (const [cue, id] of Object.entries(TD_SFX) as [TdSfx, string][]) {
      const url = assets?.find((asset) => asset.id === id)?.url;
      if (url) urls.set(cue, url);
    }
    return urls;
  }, [assets]);
  useEffect(() => {
    if (sfxOn && sounds.size > 0) void preloadAudioBuffers([...sounds.values()]);
  }, [sfxOn, sounds]);
  const playSound = (cue: TdSfx, volume: number) => {
    const url = sounds.get(cue);
    if (sfxOn && url) void playPreloadedAudio(url, savedSfxVolume() * volume);
  };
  const appearance = useMemo(
    () =>
      resolveSpriteAppearance(
        user
          ? {
              gender: user.gender,
              spriteBodyStyle: user.spriteBodyStyle,
              attributes: user.attributes,
              items: user.items,
            }
          : { gender: "Male" },
      ),
    [user],
  );
  // A run only this tab holds is lost with the tab until its claim succeeds.
  const isOnlyInTab =
    !!userId &&
    run.unsaved &&
    run.phase !== "lobby" &&
    (!run.outcome || (!run.outcome.claimed && run.outcome.retryable));
  const leaveGuard = useUnsavedChangesGuard(isOnlyInTab, {
    title: "Leave this run?",
    message:
      "This run is not saved on this device, so leaving or reloading before it is claimed can lose it and its scrolls.",
    proceedLabel: "Leave",
  });

  // A signed-in player's runs are claimable only once the profile names them, so their
  // lobby waits for it. Visitors who look signed out see the guest lobby at once, which
  // also puts it in the prerendered page; no run starts until sign-in is confirmed.
  if (isSignedIn && (!isClerkLoaded || (!user && status === "pending")))
    return <Loader explanation="Loading user data..." />;
  // Without the profile a signed-in player would fall through to an unpaid guest run.
  if (isSignedIn && !user && status === "error")
    return (
      <ContentBox title="Connection interrupted">
        <p className="p-4">We couldn&apos;t load your character. Please try again.</p>
        <Button className="m-4" onClick={() => void utils.profile.getUser.invalidate()}>
          Try again
        </Button>
      </ContentBox>
    );
  const state = run.hud;

  if (run.phase === "lobby") {
    const lobby = (
      <ContentBox
        title={userId ? "Tower Defense" : "Ninja Tower Defense"}
        subtitle={
          userId
            ? "Defend the village against endless raiders"
            : "Free to play in your browser"
        }
        defaultBackHref="/manual#minigames"
        topRightContent={<LeaderboardLink />}
      >
        <TowerDefenseLobby
          isGuest={!userId}
          level={user?.level ?? 1}
          dailyDutyDone={
            user
              ? tdDailyDutyDone(
                  user.towerDefenseDutyAt,
                  new Date(Date.now() - timeDiff),
                )
              : undefined
          }
          villageName={user?.village?.name}
          progress={progress.data}
          saved={run.saved}
          isStarting={run.isStarting}
          isResuming={run.isResuming}
          isPurchasing={run.isPurchasing}
          isLoading={!isClerkLoaded}
          onStart={(startWave, replaceSaved) => void run.start(startWave, replaceSaved)}
          onResume={run.resume}
          onDiscard={run.discardSaved}
          onBuy={(upgradeId) => void run.buyDojo(upgradeId)}
        />
      </ContentBox>
    );
    // A quest challenge is opened from the logbook by its query; the prerendered page,
    // guests and visitors without one see the lobby.
    return (
      <Suspense fallback={lobby}>
        <ChallengeRoute
          lobby={lobby}
          render={(request) =>
            user ? (
              <ContentBox
                title="Hold Your Ground"
                subtitle="Defend this position until the last wave breaks"
                defaultBackHref="/profile?tab=dashboard#progress-heading"
              >
                <TowerDefenseChallenge
                  challenge={findTowerDefenseChallenge(user, request)}
                  saved={run.saved}
                  isStarting={run.isStarting}
                  isResuming={run.isResuming}
                  onStart={(replaceSaved) => void run.start(1, replaceSaved, request)}
                  onResume={run.resume}
                />
              </ContentBox>
            ) : (
              lobby
            )
          }
        />
      </Suspense>
    );
  }

  return (
    <ContentBox
      title={state?.config.challenge ? "Hold Your Ground" : "Tower Defense"}
      subtitle={state ? `Wave ${state.wave}` : "Run"}
      defaultBackHref="/manual#minigames"
      noRightAlign
      padding={false}
    >
      <TowerDefensePlayfield
        run={run}
        Arena={TowerDefenseArena}
        appearance={appearance}
        roster={roster.isPending ? undefined : (roster.data ?? [])}
        hitAsset={assets?.find((asset) => asset.id === ID_ANIMATION_HIT)}
        smokeAsset={assets?.find((asset) => asset.id === ID_ANIMATION_SMOKE)}
        sfxOn={!!sfxOn}
        onSound={setSfxEnabled}
        playSound={playSound}
        isGuest={!userId}
        guardDialog={leaveGuard.dialog}
        confirmLeave={leaveGuard.confirmDiscard}
        guestNote={
          <p className="text-sm">Log in to keep scrolls and train in the Guard Hall.</p>
        }
        resultsAction={
          run.outcome?.won &&
          run.outcome.claimed && (
            <Button asChild>
              <Link href="/profile?tab=dashboard#progress-heading">
                <ScrollText className="mr-2 h-4 w-4" />
                Open logbook
              </Link>
            </Button>
          )
        }
      />
    </ContentBox>
  );
}

/** What the page's query names: a challenge, or the lobby without one. */
const ChallengeRoute = (props: {
  lobby: ReactNode;
  render: (request: { questId: string; objectiveId: string }) => ReactNode;
}) => {
  const searchParams = useSearchParams();
  const questId = searchParams.get("quest");
  const objectiveId = searchParams.get("objective");
  return questId && objectiveId ? props.render({ questId, objectiveId }) : props.lobby;
};

const LeaderboardLink = () => (
  <Button asChild size="sm">
    <Link href="/manual/towerDefense/leaderboard">
      <Trophy className="mr-2 h-4 w-4" />
      Leaderboard
    </Link>
  </Button>
);
