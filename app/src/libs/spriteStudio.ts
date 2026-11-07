import type { SpriteGenerationStatus } from "@/drizzle/constants";

/** Every 4n+1 clip keeps half its frames: 16 fills an 8x2 sheet, 24 an 8x3 one. */
const SHORT_CLIP_FRAMES = 33;
const LONG_CLIP_FRAMES = 49;
/** Playback speed of a finished sheet. */
export const SPRITE_SHEET_FPS = 12.5;
const KEEP_CHARACTER =
  "Keep the same character, outline, colours, proportions, size and facing direction, keep hold of anything it carries, and end exactly in the starting pose. Add no effects, shadow, floor or background.";

/** Art styles gameasset.dev accepts when drawing a new character. */
export const SpriteCharacterStyles = [
  "Anime",
  "Pixel Art",
  "Hand Painted",
  "Cartoon",
  "Dark Fantasy",
] as const;

export const SpriteBodyPlans = [
  { id: "biped", label: "Two legs" },
  { id: "quadruped", label: "Four legs" },
  { id: "snake", label: "Serpent" },
  { id: "floating", label: "Floating" },
  { id: "flyer", label: "Winged" },
] as const;
export type SpriteBodyPlan = (typeof SpriteBodyPlans)[number]["id"];

/** Starting points for the motion prompt; the wording avoids what breaks generated clips. */
export const SpriteMotionPresets = [
  {
    id: "idle",
    label: "Idle",
    motion: "idle",
    frames: LONG_CLIP_FRAMES,
    prompts: {
      biped:
        "stands in a relaxed ready stance, shoulders and chest rising and falling gently",
      quadruped: "stands alert, chest rising and falling gently, tail swaying slowly",
      snake: "sways its raised head slowly from side to side",
      floating: "drifts gently up and down while its loose parts sway",
      flyer: "beats its wings slowly while hovering in place",
    },
  },
  {
    id: "move",
    label: "Walk",
    motion: "move",
    frames: SHORT_CLIP_FRAMES,
    prompts: {
      biped: "walks steadily in place, legs alternating, arms swinging naturally",
      quadruped: "trots steadily in place, diagonal legs moving together",
      snake: "slithers in place, its body rippling in smooth waves",
      floating: "drifts forward in place, body leaning into the movement",
      flyer: "flies in place with strong, even wing beats",
    },
  },
  {
    id: "strike",
    label: "Strike",
    motion: "custom",
    frames: SHORT_CLIP_FRAMES,
    prompts: {
      biped:
        "lunges forward into a hard melee strike, body leaning into the blow, then recovers",
      quadruped:
        "lunges forward with its front low and body stretched to bite, then recovers",
      snake: "thrusts its head far forward with the mouth open, then recoils",
      floating:
        "surges forward with its body stretched toward the target, then settles back",
      flyer: "swoops forward with wings swept back, then settles back",
    },
  },
  {
    id: "ranged",
    label: "Ranged",
    motion: "custom",
    frames: SHORT_CLIP_FRAMES,
    prompts: {
      biped:
        "throws an attack at a distant target, one arm thrust fully forward and torso twisting, then recovers",
      quadruped:
        "thrusts its head out and roars with the mouth wide open, then recovers",
      snake:
        "stretches its neck forward and spits with the mouth wide open, then recoils",
      floating: "tilts forward and thrusts out one limb, then settles back",
      flyer: "spreads its wings wide and thrusts its head forward, then settles back",
    },
  },
  {
    id: "blast",
    label: "Blast",
    motion: "custom",
    frames: SHORT_CLIP_FRAMES,
    prompts: {
      biped:
        "bends its knees, then flings its arms out wide with the chest open and head back, then recovers",
      quadruped:
        "rears up with its chest high and head thrown back in a roar, then lands",
      snake: "rises tall with its head high and mouth wide open, then sinks back",
      floating: "expands and flings every limb outward, then draws back in",
      flyer: "throws its wings to full spread with the chest up, then folds them back",
    },
  },
  {
    id: "powerup",
    label: "Power up",
    motion: "custom",
    frames: SHORT_CLIP_FRAMES,
    prompts: {
      biped:
        "drops into a wide low stance with fists clenched beside the chest and head thrown back, then rises",
      quadruped:
        "rears back on its hind legs with its back arched and head up, then lands",
      snake: "coils tighter and raises its head high, then relaxes",
      floating: "rises high and swells with every limb flung upward, then settles",
      flyer: "throws its wings straight up with its chest out, then lowers them",
    },
  },
  {
    id: "guard",
    label: "Guard",
    motion: "custom",
    frames: SHORT_CLIP_FRAMES,
    prompts: {
      biped: "crouches slightly and braces with its chin tucked, then rises",
      quadruped: "crouches low and braces with its head tucked down, then rises",
      snake: "pulls its head back into tight coils, then uncoils",
      floating: "draws in on itself with its limbs wrapped around the body, then opens",
      flyer: "folds its wings forward around its body, then opens them",
    },
  },
  {
    id: "heal",
    label: "Heal",
    motion: "custom",
    frames: SHORT_CLIP_FRAMES,
    prompts: {
      biped: "bows its head with relaxed shoulders, then lifts it again",
      quadruped: "lowers its head and settles its body, then lifts its head again",
      snake: "lowers its head onto its coils, then lifts it again",
      floating: "draws gently inward with its head bowed, then opens",
      flyer: "folds its wings and bows its head, then lifts it again",
    },
  },
  {
    id: "custom",
    label: "Custom",
    motion: "custom",
    frames: SHORT_CLIP_FRAMES,
    prompts: null,
  },
] as const;
export type SpriteMotionPreset = (typeof SpriteMotionPresets)[number];
export type SpriteMotionPresetId = SpriteMotionPreset["id"];

/** How many frames a clip of this length leaves on the finished sheet. */
export const spriteSheetFrames = (clipFrames: number) => Math.floor(clipFrames / 2);

/** Compose the editable motion prompt for a preset and body plan. */
export const spriteMotionPrompt = (preset: SpriteMotionPreset, body: SpriteBodyPlan) =>
  preset.prompts ? `The character ${preset.prompts[body]}. ${KEEP_CHARACTER}` : "";

/** The closest preset for an AI action, so assigning a sprite starts from a fitting motion. */
export const presetForAction = (actionKey: string): SpriteMotionPresetId => {
  if (actionKey === "idle" || actionKey === "move") return actionKey;
  if (actionKey === "basic:defensiveStance") return "guard";
  if (actionKey === "basic:offensiveStance") return "powerup";
  if (actionKey === "basic:cleanse" || actionKey === "basic:clear") return "heal";
  return "strike";
};

/** Remote work is still running; the studio keeps syncing while any exist. */
export const isSpriteGenerationActive = (status: SpriteGenerationStatus) =>
  status === "QUEUED" || status === "PROCESSING" || status === "PREPARING";
