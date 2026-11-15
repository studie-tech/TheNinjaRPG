/**
 * Compact text encoding of a run's action log, used for claims and local saves.
 *
 * Each action is `<tick delta><kind letter><arguments>` and actions are separated by
 * `;`. Tick deltas and integers are base 36 (negative integers carry a leading `-`),
 * names stay as written and arguments are separated by `,`, e.g. `3Gtiger,5k,-46`.
 * Ticks are stored as the distance to the previous action, so a decoded log is always
 * in tick order. Decoding validates every value against the format below, which is
 * the wire contract for `TdAction`: a kind missing from it, or an argument of the
 * wrong type, fails to compile.
 */
import {
  TD_SEALS,
  TD_SENTRIES,
  TD_SHOP,
  TD_ULTIMATES,
} from "@/libs/towerDefense/content";
import {
  TD_TARGET_MODES,
  type TdAction,
  type TdActionKind,
} from "@/libs/towerDefense/sim";

type ArgumentsOf<Kind extends TdActionKind> =
  Extract<TdAction, [number, Kind, ...unknown[]]> extends [
    number,
    Kind,
    ...infer Rest extends unknown[],
  ]
    ? Rest
    : never;
type IntegerRange = { min: number; max: number };
type ArgumentFormat<T> = [T] extends [string] ? readonly T[] : IntegerRange;
type ArgumentFormats<Args extends unknown[]> = {
  [Index in keyof Args]: ArgumentFormat<Args[Index]>;
};
type ActionFormat<Kind extends TdActionKind> = {
  code: string;
  args: ArgumentFormats<ArgumentsOf<Kind>>;
};

const coordinate: IntegerRange = { min: -3000, max: 3000 };
const slot: IntegerRange = { min: 0, max: 5 };
const id: IntegerRange = { min: 0, max: Number.MAX_SAFE_INTEGER };

const FORMAT: { [Kind in TdActionKind]: ActionFormat<Kind> } = {
  buy: { code: "B", args: [TD_SHOP] },
  max: { code: "M", args: [TD_SHOP] },
  spend: { code: "P", args: [] },
  build: { code: "D", args: [slot, TD_SENTRIES] },
  upgrade: { code: "U", args: [slot] },
  sell: { code: "E", args: [slot] },
  ult: { code: "X", args: [TD_ULTIMATES, coordinate, coordinate] },
  perk: { code: "K", args: [{ min: 0, max: 9 }] },
  reroll: { code: "R", args: [] },
  aim: { code: "A", args: [TD_TARGET_MODES] },
  focus: { code: "F", args: [id] },
  blink: { code: "J", args: [coordinate, coordinate] },
  sub: { code: "S", args: [] },
  seal: { code: "G", args: [TD_SEALS, coordinate, coordinate] },
  trap: { code: "T", args: [coordinate, coordinate] },
  loot: { code: "L", args: [id] },
  call: { code: "C", args: [] },
  auto: { code: "O", args: [{ min: 0, max: 1 }] },
  quit: { code: "Q", args: [] },
};

type ArgumentDecoder = { names: ReadonlySet<string> } | IntegerRange;

const DECODERS = new Map(
  Object.entries(FORMAT).map(([kind, format]) => [
    format.code,
    {
      kind,
      args: (format.args as readonly (readonly string[] | IntegerRange)[]).map(
        (spec): ArgumentDecoder => ("min" in spec ? spec : { names: new Set(spec) }),
      ),
    },
  ]),
);
const INTEGER_ARGS = Object.fromEntries(
  Object.entries(FORMAT).map(([kind, format]) => [
    kind,
    (format.args as readonly (readonly string[] | IntegerRange)[]).map(
      (spec) => "min" in spec,
    ),
  ]),
) as Record<TdActionKind, boolean[]>;

const ACTION = /^([0-9a-z]{1,8})([A-Z])(.*)$/;
const INTEGER = /^-?[0-9a-z]{1,11}$/;

/** Encode one action placed after an action at `previousTick`. */
export const encodeTdAction = (action: TdAction, previousTick: number): string => {
  const [tick, kind, ...args] = action;
  const integers = INTEGER_ARGS[kind];
  let encoded = `${(tick - previousTick).toString(36)}${FORMAT[kind].code}`;
  for (const [index, value] of args.entries())
    encoded += `${index > 0 ? "," : ""}${integers[index] ? (value as number).toString(36) : value}`;
  return encoded;
};

/** Encode a whole log in tick order. */
export const encodeTdActions = (actions: readonly TdAction[]): string => {
  let previousTick = 0;
  const parts: string[] = [];
  for (const action of actions) {
    parts.push(encodeTdAction(action, previousTick));
    previousTick = action[0];
  }
  return parts.join(";");
};

/**
 * Decode an encoded log, or null when it is malformed, holds a value its action does
 * not accept, or exceeds the limits.
 */
export const decodeTdActions = (
  text: string,
  limits: { maxTick: number; maxActions: number },
): TdAction[] | null => {
  if (text === "") return [];
  const parts = text.split(";");
  if (parts.length > limits.maxActions) return null;
  const actions: TdAction[] = [];
  let tick = 0;
  for (const part of parts) {
    const match = ACTION.exec(part);
    const decoder = match?.[2] ? DECODERS.get(match[2]) : undefined;
    if (!match?.[1] || !decoder) return null;
    tick += Number.parseInt(match[1], 36);
    if (tick > limits.maxTick) return null;
    const raw = match[3] ? match[3].split(",") : [];
    if (raw.length !== decoder.args.length) return null;
    const action: (number | string)[] = [tick, decoder.kind];
    for (const [index, value] of raw.entries()) {
      const spec = decoder.args[index];
      if (!spec) return null;
      if ("names" in spec) {
        if (!spec.names.has(value)) return null;
        action.push(value);
      } else {
        const number = INTEGER.test(value) ? Number.parseInt(value, 36) : Number.NaN;
        if (!(number >= spec.min && number <= spec.max)) return null;
        action.push(number);
      }
    }
    actions.push(action as TdAction);
  }
  return actions;
};
