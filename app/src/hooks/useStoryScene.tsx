import { atom, useSetAtom } from "jotai";
import type { ComponentProps } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/app/_trpc/client";
import { IMG_URL_ASSISTANT, TUTORIAL_STARTER_QUEST_ID } from "@/drizzle/constants";
import { useQuestFight } from "@/hooks/useQuestFight";
import { type StoryOffer, useStoryOffer } from "@/hooks/useStoryOffer";
import type { NpcDialogModal } from "@/layout/NpcDialogModal";
import { StoryAnswers } from "@/layout/StoryAnswers";
import type { MapAnchor } from "@/libs/mapAnchors";
import type { MapSpeechLine } from "@/libs/mapSpeech";
import { isWanderTile } from "@/libs/overworldWander";
import type { TravelScene } from "@/libs/rendering/scenes/travel";
import type { NormalizedSectorMap } from "@/libs/sector-map/types";
import { getSectorTile } from "@/libs/sector-map/validation";
import type { SectorUser } from "@/libs/sector-map/world-types";
import { storyPlacementId } from "@/libs/storyActors";
import {
  CAST_AI_IDS,
  CAST_NAMES,
  planStoryMeeting,
  planStoryScene,
  STORY_LINES,
  type StoryLine,
  type StoryLineId,
  type StoryRole,
  type StoryScene,
  type StorySceneKind,
  storyRoleKey,
  storySceneActors,
} from "@/libs/storyScene";
import {
  STARTER_QUEST_OBJECTIVES,
  TUTORIAL_AMBUSH_STEP_ID,
  TUTORIAL_ARRIVAL_STEP_ID,
  TUTORIAL_VILLAGE_CHOICE_STEP_ID,
  toObjectiveIds,
} from "@/libs/tutorial";
import type { TutorialMapScene, TutorialStepConfig } from "@/libs/tutorialSteps";
import { parseHtml } from "@/utils/parse";

/** True while the ambush plays on the map, when its lesson has nothing to answer yet. */
export const storyScenePlayingAtom = atom(false);

/**
 * Tutorial step a character on the map or page is speaking for, and whose words it says, so the
 * lesson leaves those out: the lesson's, the quest objective's or the speaker's own.
 */
export const spokenStepAtom = atom<{
  stepId: string;
  words: "lesson" | "objective" | "own";
} | null>(null);

/** Whose words a scene's speaker says. */
export const spokenWordsOf = (says: TutorialMapScene["says"] | undefined) =>
  typeof says === "string" ? "own" : (says?.from ?? "lesson");

/** What a scene's speaker says. */
export const spokenTextOf = (
  says: TutorialMapScene["says"],
  step: TutorialStepConfig,
  offer: StoryOffer | undefined,
) =>
  typeof says === "string"
    ? says
    : says.from === "objective"
      ? offer?.dialog?.description
      : step.description;

/** The player closed the village choice to look around; talking to the proctor reopens it. */
export const villageChoiceHiddenAtom = atom(false);

/** The moments of the opening the sector map stages. */
const OPENING_KINDS: Record<string, Exclude<StorySceneKind, "meeting">> = {
  [TUTORIAL_ARRIVAL_STEP_ID]: "greeting",
  [TUTORIAL_AMBUSH_STEP_ID]: "ambush",
  "combat-rematch": "standoff",
};

/**
 * The tutorial's scenes on the sector map, drawn only for the player: the opening of the
 * Academy Trials, and the meetings of steps with a `mapScene`. The figures are added to what
 * the renderer reads, so no map logic meets them; `onStoryTap` runs what the control of a
 * tapped one does. `lines` hold the answers the speaker waits for, and `conversation` the
 * dialog talking to them opens. `target` is what the lesson points at. `flash` and `smoke`
 * count up when their overlay should play; a player who prefers reduced motion sees neither,
 * and the scene as it ends.
 */
export const useStoryScene = (info: {
  step: TutorialStepConfig | undefined;
  /** The viewer's sector and where they stand in it, once the map shows it. */
  sector: number;
  map: NormalizedSectorMap | undefined;
  getPosition: () => { x: number; y: number } | undefined;
  /** The rendered map, once it shows; scenery may still be arriving. */
  scenery: StoryScenery | null | undefined;
  /** The server-corrected clock the renderer walks NPCs by. */
  getNow: () => number;
  /** Has the renderer reconcile its actors. */
  onCastChange: () => void;
}) => {
  const stepId = info.step?.id;
  const mapScene = info.step?.mapScene;
  const opening = stepId ? OPENING_KINDS[stepId] : undefined;
  const kind: StorySceneKind | undefined = opening ?? (mapScene && "meeting");
  // One scene lasts through the lessons that share its figures and place.
  const sceneKey = mapScene ? mapScene.cast.join() : kind;
  const { data: art, isPending } = api.travel.getStoryCast.useQuery(undefined, {
    enabled: !!kind,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [scene, setScene] = useState<{ plan: StoryScene; startAt: number }>();
  const [flash, setFlash] = useState(0);
  const [smoke, setSmoke] = useState(0);
  const [spoken, setSpoken] = useState<StoryLineId[]>([]);
  const lemuRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const infoRef = useRef(info);
  useLayoutEffect(() => {
    infoRef.current = info;
  });
  const setPlaying = useSetAtom(storyScenePlayingAtom);

  // Stage each scene once, where the player stands as its lesson opens on a loaded map.
  // Artwork that fails to load leaves its figures out rather than holding the lesson.
  const { scenery } = info;
  const [settled, setSettled] = useState<StoryScenery>();
  useEffect(() => {
    if (!kind || !scenery) return;
    let isCurrent = true;
    const settle = () => {
      if (isCurrent) setSettled(scenery);
    };
    const timer = setTimeout(settle, SCENERY_WAIT_MS);
    void scenery.sceneryReady().then(settle, settle);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [kind, scenery]);
  const isStageable =
    !!kind && !!scenery && settled === scenery && !!info.map && !isPending;
  useEffect(() => {
    if (!isStageable || !kind || !scenery) {
      setScene(undefined);
      return;
    }
    const { map, sector, getPosition, getNow } = infoRef.current;
    const player = getPosition();
    const { step: lesson } = infoRef.current;
    if (!map || !player) return;
    const isReduced = prefersReducedMotion();
    const now = getNow();
    const startAt = isReduced ? now - REDUCED_HEAD_START_MS : now;
    const ground = {
      player,
      isOpen: (tile: { x: number; y: number }) =>
        isWanderTile(getSectorTile(map, tile), false),
      isCovered: (tile: { x: number; y: number }) =>
        scenery.isTileCovered(sector, tile),
      startAt,
    };
    const plan =
      kind !== "meeting"
        ? planStoryScene({ ...ground, kind, previousLemu: lemuRef.current })
        : lesson?.mapScene
          ? planStoryMeeting({ ...ground, cast: lesson.mapScene.cast })
          : undefined;
    if (!plan) {
      setScene(undefined);
      return;
    }
    lemuRef.current = plan.cast
      .find((entry) => entry.role === "lemu")
      ?.walk.tiles.at(-1);
    setScene({ plan, startAt });
    if (plan.kind !== "ambush" || isReduced) return;
    setPlaying(true);
    setFlash((count) => count + 1);
    const timers = [
      setTimeout(() => setSmoke((count) => count + 1), plan.smokeAt),
      setTimeout(() => setPlaying(false), plan.endsAt),
    ];
    return () => {
      timers.forEach(clearTimeout);
      setPlaying(false);
    };
  }, [kind, sceneKey, isStageable, scenery, setPlaying]);

  // Each line stands for its own stretch of the scene.
  const setSpokenStep = useSetAtom(spokenStepAtom);
  const says = mapScene?.says;
  const spokenWords = spokenWordsOf(says);
  useEffect(() => {
    if (!scene || !stepId) return;
    const { lines } = scene.plan;
    const speak = () => {
      const elapsed = infoRef.current.getNow() - scene.startAt;
      setSpoken(
        lines
          .filter((line) => elapsed >= line.from && elapsed < line.until)
          .map(lineId),
      );
    };
    speak();
    setSpokenStep({ stepId, words: spokenWords });
    const elapsed = infoRef.current.getNow() - scene.startAt;
    const timers = lines
      .flatMap((line) => [line.from, line.until])
      .filter((at) => at > elapsed && Number.isFinite(at))
      // A timer can come a moment early; the next frame's clock is past the boundary.
      .map((at) => setTimeout(speak, at - elapsed + 30));
    return () => {
      timers.forEach(clearTimeout);
      setSpoken([]);
      setSpokenStep(null);
    };
  }, [scene, stepId, spokenWords, setSpokenStep]);
  // A figure takes the map's attack control once its fight is the player's to start.
  const isRematch = mapScene?.offers === "fight";
  const fight = useQuestFight(
    isRematch && typeof info.step?.relatedValue === "string"
      ? {
          questId: info.step.relatedValue,
          battleId: info.step.objectiveId
            ? toObjectiveIds(info.step.objectiveId)[0]
            : "",
        }
      : {
          questId: TUTORIAL_STARTER_QUEST_ID,
          dialogId: STARTER_QUEST_OBJECTIVES.stand,
          battleId: STARTER_QUEST_OBJECTIVES.double,
        },
  );
  const foe = isRematch ? mapScene.cast.at(-1) : "double";
  const canAttack =
    !!fight && !!foe && spoken.includes(isRematch ? "meeting" : "challenge");
  // A speaker takes the talk control while they wait for an answer.
  const offer = useStoryOffer(mapScene && info.step);
  const speaker = mapScene?.cast[0];
  const isVillageChoice = stepId === TUTORIAL_VILLAGE_CHOICE_STEP_ID;
  const setVillageChoiceHidden = useSetAtom(villageChoiceHiddenAtom);
  const [talkingId, setTalkingId] = useState<string>();
  const canTalk =
    !!offer?.dialog && mapScene?.offers === "answer" && spoken.includes("meeting");
  const talk = () =>
    isVillageChoice ? setVillageChoiceHidden(false) : setTalkingId(offer?.dialog?.id);
  const step = info.step;
  const lines: MapSpeechLine[] = (scene?.plan.lines ?? [])
    .filter((line) => spoken.includes(line.id))
    .flatMap((line) => {
      const text =
        step &&
        (line.id === "meeting"
          ? says && spokenTextOf(says, step, offer)
          : lineText(line.id, step));
      return text
        ? [
            {
              // The bubble of an answered question is replaced by the next one's.
              id: `${step.id}:${line.id}:${offer?.dialog?.id ?? ""}`,
              anchor: { kind: "actor" as const, key: storyRoleKey(line.role) },
              speaker: line.role === "pup" ? undefined : CAST_NAMES[line.role],
              tone: line.id === "yelp" ? ("shout" as const) : ("say" as const),
              text: typeof text === "string" ? parseHtml(text) : text,
              footer:
                line.id === "meeting" && offer ? (
                  <StoryAnswers
                    offer={offer}
                    onTalk={talk}
                    talkLabel={isVillageChoice ? "Choose my village" : undefined}
                  />
                ) : undefined,
            },
          ]
        : [];
    });

  // The frame loop asks for the merged list every frame; it is rebuilt only when the
  // players or the figures on the map change.
  const merged = useRef<{ users: SectorUser[]; key: string; result: SectorUser[] }>(
    undefined,
  );
  const withCast = (users: SectorUser[]): SectorUser[] => {
    if (!scene) return users;
    const elapsed = infoRef.current.getNow() - scene.startAt;
    const cast = storySceneActors(
      scene.plan,
      elapsed,
      art ?? {},
      infoRef.current.sector,
      {
        ...(canAttack && foe ? { [foe]: "HOSTILE" as const } : {}),
        ...(canTalk && speaker ? { [speaker]: "FRIENDLY" as const } : {}),
      },
    );
    const key = `${scene.startAt}:${cast
      .map(
        (actor) =>
          `${actor.userId}@${actor.npcWalk?.startAt}:${actor.npcInteractionType}`,
      )
      .join("|")}`;
    const previous = merged.current;
    if (previous?.users === users && previous.key === key) return previous.result;
    merged.current = { users, key, result: [...users, ...cast] };
    if (previous?.key !== key) infoRef.current.onCastChange();
    return merged.current.result;
  };
  const withCastRef = useRef(withCast);
  useLayoutEffect(() => {
    withCastRef.current = withCast;
  });

  const speakerAiId = speaker && CAST_AI_IDS[speaker];
  const portrait = speakerAiId ? art?.[speakerAiId]?.avatar : IMG_URL_ASSISTANT;
  const marker: MapAnchor | null = scene
    ? { kind: "tile", ...scene.plan.marker, sector: info.sector }
    : null;
  return {
    withCast: (users: SectorUser[]) => withCastRef.current(users),
    lines,
    onStoryTap: ((placementId) => {
      const actor = merged.current?.result.find(
        (user) => user.npcPlacementId === placementId,
      );
      if (!actor) return null;
      if (canTalk && speaker && placementId === storyPlacementId(speaker)) {
        // A touch ends with a click where it was, which must not reach the dialog.
        setTimeout(talk, TAP_SETTLE_MS);
        return {};
      }
      if (!canAttack || !foe || placementId !== storyPlacementId(foe)) return null;
      fight.start();
      return { attacked: actor };
    }) satisfies StorySceneTap,
    conversation:
      offer?.dialog && talkingId === offer.dialog.id && speaker
        ? ({
            title: CAST_NAMES[speaker],
            dialog: offer.dialog,
            characters: portrait ? [portrait] : undefined,
            answers: offer.dialog.answers,
            isPending: offer.isPending,
            onClose: () => setTalkingId(undefined),
          } satisfies ComponentProps<typeof NpcDialogModal>)
        : null,
    /** Who speaks in a meeting, which a lesson keeps lit with their words. */
    speaker: scene && speaker ? actorAnchor(speaker) : null,
    isAttacking: !!fight?.isPending,
    marker,
    target:
      canAttack && foe && !fight.isPending
        ? actorAnchor(foe)
        : scene?.plan.kind === "greeting"
          ? marker
          : null,
    flash,
    smoke,
  };
};

/** What the scene asks of the rendered map. */
type StoryScenery = Pick<TravelScene, "sceneryReady" | "isTileCovered">;

/** Long enough after a tap on the map for the click that follows a touch to have come. */
const TAP_SETTLE_MS = 100;

/** Longest the scene waits for scenery to stand its figures clear of. */
const SCENERY_WAIT_MS = 4000;

/**
 * What a tap on a figure does: nothing here (null, and the ground behind it takes the tap),
 * or it was taken, with the figure now under attack.
 */
export type StorySceneTap = (placementId: string) => { attacked?: SectorUser } | null;

const actorAnchor = (role: StoryRole): MapAnchor => ({
  kind: "actor",
  key: storyRoleKey(role),
});

const lineId = (line: StoryLine) => line.id;

/** The words of a line: Lemu's are the lesson's own, which the dock shows without a map. */
const lineText = (id: Exclude<StoryLineId, "meeting">, step: TutorialStepConfig) =>
  id === "warning"
    ? step.sceneLead?.description
    : id === "greeting" || id === "challenge"
      ? step.description
      : STORY_LINES[id];

/** Long enough before now that a scene staged without motion has ended. */
const REDUCED_HEAD_START_MS = 60_000;

const prefersReducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
