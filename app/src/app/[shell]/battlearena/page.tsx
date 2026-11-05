"use client";

import { useEffect } from "react";
import { TUTORIAL_ARENA_DUMMY_ID } from "@/drizzle/constants";
import { useLocalStorage } from "@/hooks/localstorage";
import { useTutorialStep } from "@/hooks/tutorial";
import { useArenaView } from "@/hooks/useArenaView";
import BanInfo from "@/layout/BanInfo";
import { ArenaMode } from "@/layout/battlearena/ArenaMode";
import { ArenaModeShell } from "@/layout/battlearena/ArenaModeShell";
import { ArenaOverview } from "@/layout/battlearena/ArenaOverview";
import { PyramidMode } from "@/layout/battlearena/PyramidMode";
import { RankedMode } from "@/layout/battlearena/RankedMode";
import { SparringMode } from "@/layout/battlearena/SparringMode";
import { TrainingMode } from "@/layout/battlearena/TrainingMode";
import ContentBox from "@/layout/ContentBox";
import Loader from "@/layout/Loader";
import { useRequireInVillage } from "@/utils/UserContext";
import type { StatSchemaType } from "@/validators/combat";

/** The battle arena: an overview of its modes, or the mode named in the URL hash. */
export default function Arena() {
  const { mode, openMode, openOverview } = useArenaView();
  const [aiId, setAiId] = useLocalStorage<string | undefined>(
    "arenaAI4",
    TUTORIAL_ARENA_DUMMY_ID,
  );
  const [statDistribution, setStatDistribution] = useLocalStorage<
    StatSchemaType | undefined
  >("statDistribution", undefined);

  // Ensure user is in village
  const { userData, access } = useRequireInVillage("/battlearena");

  // The tutorial's arena step fights the Academy Dummy in the Arena mode
  const { currentStep } = useTutorialStep();
  const isTutorialArena = currentStep?.advanceOn === "arenaStart";
  useEffect(() => {
    if (isTutorialArena && aiId !== TUTORIAL_ARENA_DUMMY_ID) {
      setAiId(TUTORIAL_ARENA_DUMMY_ID);
    }
  }, [isTutorialArena, aiId]);

  // Guards
  if (!access) return <Loader explanation="Accessing Battle Arena" />;
  if (!userData) return <Loader explanation="Loading user" />;
  if (userData.isBanned) return <BanInfo />;

  const view = isTutorialArena ? "Arena" : mode;

  return (
    <ContentBox
      title="Battle Arena"
      subtitle={view ? MODE_SUBTITLES[view] : "Pick how you want to fight"}
      defaultBackHref="/village"
      padding={false}
    >
      {view === null ? (
        <ArenaOverview onOpen={openMode} />
      ) : (
        <ArenaModeShell mode={view} onSelect={openMode} onOverview={openOverview}>
          {view === "Arena" && (
            <ArenaMode
              aiId={isTutorialArena ? TUTORIAL_ARENA_DUMMY_ID : aiId}
              setAiId={setAiId}
            />
          )}
          {view === "Sparring" && <SparringMode />}
          {view === "Training" && (
            <TrainingMode
              statDistribution={statDistribution}
              setStatDistribution={setStatDistribution}
            />
          )}
          {view === "PVP Rank" && <RankedMode />}
          {view === "Battle Pyramid" && <PyramidMode />}
        </ArenaModeShell>
      )}
    </ContentBox>
  );
}

const MODE_SUBTITLES = {
  Arena: "Fight creatures picked for your level",
  Sparring: "Spar with ninja from any village, with no consequences",
  Training: "An unbeatable dummy that self-destructs. Practice with no risk",
  "PVP Rank": "Equal stats, ranked loadout, climb the divisions",
  "Battle Pyramid": "Climb a tower floor by floor, one tower at a time",
} as const;
