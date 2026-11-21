"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { CS_SFX, type CsSfx } from "@/drizzle/constants";
import { useChakraStormRun } from "@/hooks/useChakraStormRun";
import { ChakraStormChallenge } from "@/layout/ChakraStormChallenge";
import { LeaderboardButton } from "@/layout/ChakraStormHud";
import { ChakraStormLobby } from "@/layout/ChakraStormLobby";
import { ChakraStormPlayfield } from "@/layout/ChakraStormPlayfield";
import ContentBox from "@/layout/ContentBox";
import { useGameSettings } from "@/layout/GameSettings";
import Loader from "@/layout/Loader";
import { QUEST_LOGBOOK_HREF, QuestChallengeRoute } from "@/layout/QuestChallenge";
import { CS_STAGE_INFO, CS_STAGES, type CsStage } from "@/libs/chakraStorm/content";
import { csStageUnlocked } from "@/libs/chakraStorm/progress";
import { resolveSpriteAppearance } from "@/libs/lpc/appearance";
import { findQuestChallenge } from "@/libs/quest/challenge";
import { tdDailyDutyDone, tdDailyReward } from "@/libs/towerDefense/balance";
import { playPreloadedAudio, preloadAudioBuffers, savedSfxVolume } from "@/utils/audio";
import { useUserDataSelector } from "@/utils/UserContext";

// Load the renderer only once a run starts
const ChakraStormArena = dynamic(
  () => import("@/layout/ChakraStorm").then((module) => module.ChakraStormArena),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader explanation="Loading battlefield..." />
      </div>
    ),
  },
);

export default function ChakraStormPage() {
  const {
    data: user,
    isSignedIn,
    isClerkLoaded,
    status,
    timeDiff,
  } = useUserDataSelector((profile) => ({
    userId: profile.userId,
    level: profile.level,
    villageId: profile.villageId,
    chakraStormDutyAt: profile.chakraStormDutyAt,
    gender: profile.gender,
    spriteBodyStyle: profile.spriteBodyStyle,
    attributes: profile.attributes,
    items: profile.items,
    musicOn: profile.musicOn,
    buttonSfxOn: profile.buttonSfxOn,
    sfxOn: profile.sfxOn,
    bloodlineId: profile.bloodlineId,
    isOutlaw: profile.isOutlaw,
    status: profile.status,
    userQuests: profile.userQuests,
    questData: profile.questData,
    sector: profile.sector,
    longitude: profile.longitude,
    latitude: profile.latitude,
  }));
  const run = useChakraStormRun(user?.userId);
  const roster = api.towerDefense.getRoster.useQuery(undefined, {
    staleTime: Number.POSITIVE_INFINITY,
  });
  const { data: assets } = api.misc.getAllGameAssetNames.useQuery({
    ids: Object.values(CS_SFX),
  });
  const { sfxOn, setSfxEnabled } = useGameSettings(user);
  const sounds = useMemo(() => {
    const urls = new Map<CsSfx, string>();
    for (const [cue, id] of Object.entries(CS_SFX) as [CsSfx, string][]) {
      const url = assets?.find((asset) => asset.id === id)?.url;
      if (url) urls.set(cue, url);
    }
    return urls;
  }, [assets]);
  useEffect(() => {
    if (sfxOn && sounds.size > 0) void preloadAudioBuffers([...sounds.values()]);
  }, [sfxOn, sounds]);
  const playSound = (cue: CsSfx, volume: number) => {
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

  // The furthest open stage is chosen once the device's progress has loaded.
  const [stage, setStage] = useState<CsStage>("horizon");
  const chosen = useRef(false);
  const { progress } = run;
  useEffect(() => {
    if (
      chosen.current ||
      (progress.intel === 0 && Object.keys(progress.stages).length === 0)
    )
      return;
    chosen.current = true;
    // The furthest scouting region; Undercover is open to all and chosen on purpose.
    const open = CS_STAGES.filter(
      (id) => !CS_STAGE_INFO[id].endless && csStageUnlocked(progress, id),
    );
    setStage(open.at(-1) ?? "horizon");
  }, [progress]);

  // A signed-in player's runs are signed and claimed, so their lobby waits for the
  // profile; visitors who look signed out get the guest lobby at once, which is also what
  // the prerendered page holds.
  if (isSignedIn && (!isClerkLoaded || (!user && status === "pending")))
    return <Loader explanation="Loading your scout..." />;

  if (run.phase === "lobby") {
    const lobby = (
      <ContentBox
        title="Chakra Storm"
        subtitle={
          user ? "Scout Seichi for your village" : "Free to play in your browser"
        }
        defaultBackHref="/manual#minigames"
        topRightContent={<LeaderboardButton size="sm" variant="default" />}
      >
        <ChakraStormLobby
          progress={progress}
          stage={stage}
          isGuest={!user}
          isLoading={run.isLoadingProgress}
          isStarting={run.isStarting}
          isTraining={run.isTraining}
          daily={
            user
              ? {
                  reward: tdDailyReward(user.level),
                  done: tdDailyDutyDone(
                    user.chakraStormDutyAt,
                    new Date(Date.now() - timeDiff),
                  ),
                  hasVillage: !!user.villageId,
                }
              : null
          }
          onStage={setStage}
          onStart={() => {
            playSound("dash", 0.4);
            void run.start(stage);
          }}
          onTrain={(id) =>
            void run.train(id).then((bought) => {
              if (bought) playSound("seal", 0.45);
            })
          }
        />
      </ContentBox>
    );
    // A quest challenge is opened from the logbook by its query; the prerendered page,
    // guests and visitors without one see the lobby.
    return (
      <QuestChallengeRoute
        lobby={lobby}
        render={(request) => {
          const challenge = user
            ? findQuestChallenge(user, request, "win_chakra_storm")
            : null;
          return user ? (
            <ContentBox
              title="Survive the Storm"
              subtitle="Hold out in the storm until the time is up"
              defaultBackHref={QUEST_LOGBOOK_HREF}
            >
              <ChakraStormChallenge
                challenge={challenge}
                isStarting={run.isStarting}
                onStart={() => {
                  if (!challenge) return;
                  playSound("dash", 0.4);
                  void run.start(challenge.objective.stage, request);
                }}
              />
            </ContentBox>
          ) : (
            lobby
          );
        }}
      />
    );
  }

  return (
    <ContentBox
      title={run.hud?.config.challenge ? "Survive the Storm" : "Chakra Storm"}
      subtitle={run.hud ? CS_STAGE_INFO[run.hud.config.stage].name : "Scouting"}
      defaultBackHref="/manual#minigames"
      onBack={run.leave}
      padding={false}
    >
      <ChakraStormPlayfield
        run={run}
        Arena={ChakraStormArena}
        appearance={appearance}
        roster={roster.isPending ? undefined : (roster.data ?? [])}
        sfxOn={!!sfxOn}
        onSound={setSfxEnabled}
        playSound={playSound}
        onScout={(next) => {
          setStage(next);
          void run.start(next);
        }}
      />
    </ContentBox>
  );
}
