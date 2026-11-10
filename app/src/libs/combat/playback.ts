import { isSummonTemplate } from "@/libs/combat/summon";
import type {
  ActionEffect,
  BattleUserState,
  CompleteBattle,
  GroundEffect,
  LoggedHealth,
  ReturnedBattle,
  ReturnedUserState,
  UserEffect,
} from "@/libs/combat/types";
import { getEffectiveCurPool } from "@/libs/combat/util";
import type { LpcAnimation } from "@/validators/lpc";

/** Fighter fields a replay may change; all are public, so one step serves every viewer. */
const PLAYBACK_FIELDS = [
  "longitude",
  "latitude",
  "curHealth",
  "curStamina",
  "curChakra",
  "fledBattle",
  "leftBattle",
  "spriteAction",
  "spriteAnimationEvent",
] as const satisfies readonly (keyof BattleUserState & keyof ReturnedUserState)[];

type PlaybackField = (typeof PLAYBACK_FIELDS)[number];
type PlaybackUser = Pick<BattleUserState, "userId"> &
  Partial<Pick<BattleUserState, PlaybackField>>;

/** Share of a cue at which its strike lands, matched to the authored LPC frames. */
const CUE_IMPACT: Partial<Record<LpcAnimation, number>> = {
  slash: 0.5,
  thrust: 0.55,
  spellcast: 0.6,
  shoot: 0.7,
};

/**
 * One server-resolved action within a response. A batch commits only its final state, so
 * these changes let viewers replay each action in the order it happened.
 */
export type CombatPlaybackStep = {
  /** Battle version of this action's log entries. */
  version: number;
  actorId: string;
  /** Fighters on the field after this action; absent ones have not arrived or have left. */
  userIds: string[];
  /** Only the fields this action changed. */
  users: PlaybackUser[];
  addedEffectIds: string[];
  removedEffectIds: string[];
  /** Health lines this action's log entry reports, in order; absent when not recorded. */
  hits?: LoggedHealth[];
};

/** One replayed action: the actor winds up in `windup`, and `battle` lands at the strike. */
export type CombatPlaybackFrame = {
  actorId: string;
  version: number;
  cueId?: string;
  impact: number;
  windup?: ReturnedBattle;
  battle: ReturnedBattle;
  /** Health lines logged by the actions this frame lands, which its numbers show. */
  hits?: LoggedHealth[];
};

/** How hard a hit reads, by the share of the fighter's health it took. */
export type HitSeverity = "light" | "heavy" | "crushing";
/** One fighter's health change between two battles the field showed. */
export type CombatHit = { userId: string; amount: number; severity: HitSeverity };

const HEAVY_HIT_SHARE = 0.08;
const CRUSHING_HIT_SHARE = 0.25;

/**
 * Numbers for the health changes between two battles the field showed. With the landed
 * actions' logged lines, each fighter gets one number per line, matching the battle log;
 * without them (or for a change no line names) it gets its whole-point net change.
 */
export const combatHits = (
  previous: ReturnedBattle,
  next: ReturnedBattle,
  logged?: LoggedHealth[],
): CombatHit[] =>
  next.usersState.flatMap((user) => {
    const before = previous.usersState.find((row) => row.userId === user.userId);
    if (!before) return [];
    const health = getEffectiveCurPool(user, "Health");
    const lines = (logged ?? [])
      .filter((line) => line.userId === user.userId)
      .map((line) => Math.round(line.amount))
      .filter((amount) => amount !== 0);
    const net = Math.round(health - getEffectiveCurPool(before, "Health"));
    const amounts = lines.length ? lines : net ? [net] : [];
    const lastDamage = amounts.reduce(
      (last, amount, index) => (amount < 0 ? index : last),
      -1,
    );
    return amounts.map((amount, index) => {
      const share = -amount / Math.max(1, user.maxHealth);
      const severity: HitSeverity =
        (health <= 0 && index === lastDamage) || share >= CRUSHING_HIT_SHARE
          ? "crushing"
          : share >= HEAVY_HIT_SHARE
            ? "heavy"
            : "light";
      return { userId: user.userId, amount, severity };
    });
  });

/** The health lines an action's log entry carries, for its replay step. */
const loggedHealth = (effects: ActionEffect[]) =>
  effects.flatMap(({ hp }) => (hp ? [{ userId: hp.userId, amount: hp.amount }] : []));

/** Effects clone fighters between actions, so cues compare by their own identity. */
const isSameValue = (a: unknown, b: unknown) =>
  a === b ||
  (typeof a === "object" &&
    typeof b === "object" &&
    (a as { id?: string } | null)?.id !== undefined &&
    (a as { id?: string } | null)?.id === (b as { id?: string } | null)?.id);

/** Record public per-action changes during a batch, without further reads or masking. */
export const createCombatPlaybackRecorder = (battle: CompleteBattle) => {
  const fighters = (state: CompleteBattle) =>
    state.usersState.filter((user) => !isSummonTemplate(user, state.usersState));
  const effectIds = (state: CompleteBattle) =>
    new Set([...state.usersEffects, ...state.groundEffects].map(({ id }) => id));
  const values = (user: BattleUserState) =>
    Object.fromEntries(PLAYBACK_FIELDS.map((key) => [key, user[key]]));
  let users = new Map(fighters(battle).map((user) => [user.userId, values(user)]));
  let effects = effectIds(battle);
  const steps: CombatPlaybackStep[] = [];
  return {
    steps,
    record: (
      state: CompleteBattle,
      version: number,
      actorId: string,
      /** The action's log lines; their health tags become the step's numbers. */
      logged?: ActionEffect[],
    ) => {
      const nextUsers = new Map(
        fighters(state).map((user) => [user.userId, values(user)]),
      );
      const nextEffects = effectIds(state);
      steps.push({
        version,
        actorId,
        userIds: [...nextUsers.keys()],
        users: [...nextUsers].flatMap(([userId, next]) => {
          const before = users.get(userId);
          const changes = PLAYBACK_FIELDS.filter(
            (key) => !before || !isSameValue(before[key], next[key]),
          );
          return changes.length
            ? [
                {
                  userId,
                  ...Object.fromEntries(changes.map((key) => [key, next[key]])),
                },
              ]
            : [];
        }),
        addedEffectIds: [...nextEffects].filter((id) => !effects.has(id)),
        removedEffectIds: [...effects].filter((id) => !nextEffects.has(id)),
        ...(logged ? { hits: loggedHealth(logged) } : {}),
      });
      users = nextUsers;
      effects = nextEffects;
    },
  };
};

/** Cue a fighter strikes with, which paces the replay; a walk is paced by its movement. */
const strikeCue = (user?: Pick<ReturnedUserState, "spriteAction">) =>
  user?.spriteAction &&
  user.spriteAction.animation !== "walk" &&
  user.spriteAction.animation !== "idle"
    ? user.spriteAction
    : undefined;

/** Battle shown between actions: the final object, narrowed to a replay's fighters and effects. */
const viewOf = (
  next: ReturnedBattle,
  users: Map<string, ReturnedUserState>,
  effects: {
    user: Map<string, UserEffect>;
    ground: Map<string, GroundEffect>;
    visible: Set<string>;
  },
): ReturnedBattle => ({
  ...next,
  usersState: [...users.values()],
  usersEffects: [...effects.user.values()].filter(({ id }) => effects.visible.has(id)),
  groundEffects: [...effects.ground.values()].filter(({ id }) =>
    effects.visible.has(id),
  ),
});

/** The previous battle with only the actor stepping forward into its cue. */
const windupOf = (
  battle: ReturnedBattle,
  actor: ReturnedUserState,
): ReturnedBattle => ({
  ...battle,
  usersState: battle.usersState.map((user) =>
    user.userId === actor.userId
      ? {
          ...user,
          longitude: actor.longitude,
          latitude: actor.latitude,
          spriteAction: actor.spriteAction,
          spriteAnimationEvent: actor.spriteAnimationEvent,
        }
      : user,
  ),
});

/**
 * Replay actions in server order, ending on the exact committed battle. Cue state only
 * changes in steps, so a repeated response cannot restart a finished animation.
 */
export const buildPlaybackFrames = (
  previous: ReturnedBattle,
  next: ReturnedBattle,
): CombatPlaybackFrame[] => {
  const steps = next.playback ?? [];
  if (!steps.length) return inferredFrames(previous, next);
  const finalUsers = new Map(next.usersState.map((user) => [user.userId, user]));
  const previousUsers = new Map(previous.usersState.map((user) => [user.userId, user]));
  // Prefer committed effect objects; removed ones still need their earlier display.
  const byId = <T extends { id: string }>(rows: T[]) =>
    new Map(rows.map((row) => [row.id, row]));
  const effects = {
    user: byId([...previous.usersEffects, ...next.usersEffects]),
    ground: byId([...previous.groundEffects, ...next.groundEffects]),
    visible: new Set(
      [...previous.usersEffects, ...previous.groundEffects].map(({ id }) => id),
    ),
  };
  let users = previousUsers;
  const frames = steps.map((step, index) => {
    const nextUsers = new Map<string, ReturnedUserState>();
    const changes = new Map(step.users.map((user) => [user.userId, user]));
    for (const id of step.userIds) {
      const base = users.get(id) ?? finalUsers.get(id) ?? previousUsers.get(id);
      if (base) nextUsers.set(id, { ...base, ...changes.get(id) });
    }
    const before = viewOf(next, users, effects);
    const actor = nextUsers.get(step.actorId);
    const cue = changes.get(step.actorId)?.spriteAction && strikeCue(actor);
    for (const id of step.removedEffectIds) effects.visible.delete(id);
    for (const id of step.addedEffectIds) effects.visible.add(id);
    users = nextUsers;
    return {
      actorId: step.actorId,
      version: step.version,
      impact: (cue && CUE_IMPACT[cue.animation]) ?? 0,
      ...(cue && actor ? { cueId: cue.id, windup: windupOf(before, actor) } : {}),
      battle: index === steps.length - 1 ? next : viewOf(next, users, effects),
      isWalk: !cue && isWalkStep(step),
      hits: step.hits,
    };
  });
  // Fighters step one hex per action; joined, those steps share one uninterrupted walk.
  // A joined step's logged lines land with the walk that absorbs it.
  let carried: LoggedHealth[] | undefined = [];
  return frames.flatMap(({ isWalk, ...frame }, index) => {
    const joined =
      isWalk &&
      frames[index + 1]?.isWalk &&
      frames[index + 1]?.actorId === frame.actorId;
    const hits = carried && frame.hits ? [...carried, ...frame.hits] : undefined;
    if (joined) {
      carried = hits;
      return [];
    }
    carried = [];
    return [{ ...frame, hits }];
  });
};

/** Only the actor changed position, with nothing else on the field to reveal along the way. */
const isWalkStep = ({ actorId, users, ...step }: CombatPlaybackStep) =>
  users.length === 1 &&
  users[0]?.userId === actorId &&
  (users[0].longitude !== undefined || users[0].latitude !== undefined) &&
  !step.addedEffectIds.length &&
  !step.removedEffectIds.length;

/** Single actions from sources without steps still land on their fighter's strike. */
const inferredFrames = (
  previous: ReturnedBattle,
  next: ReturnedBattle,
): CombatPlaybackFrame[] => {
  const actor = next.usersState.find((user) => {
    const before = previous.usersState.find((row) => row.userId === user.userId);
    return (
      strikeCue(user) && before && before.spriteAction?.id !== user.spriteAction?.id
    );
  });
  const cue = strikeCue(actor);
  if (!actor || !cue) return [];
  return [
    {
      actorId: actor.userId,
      version: previous.version,
      cueId: cue.id,
      impact: CUE_IMPACT[cue.animation] ?? 0,
      windup: windupOf(previous, actor),
      battle: next,
    },
  ];
};
