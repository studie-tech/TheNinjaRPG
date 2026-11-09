import { describe, expect, it } from "bun:test";
import {
  presetForAction,
  SpriteBodyPlans,
  SpriteMotionPresets,
  spriteMotionPrompt,
  spriteSheetFrames,
} from "@/libs/spriteStudio";

describe("sprite studio presets", () => {
  it("fills whole rows of an 8-column sheet from every clip length", () => {
    expect(spriteSheetFrames(33)).toBe(16);
    expect(spriteSheetFrames(49)).toBe(24);
    for (const preset of SpriteMotionPresets)
      expect(spriteSheetFrames(preset.frames) % 8).toBe(0);
  });

  it("offers a prompt for every body plan and keeps the wording that breaks clips out", () => {
    for (const preset of SpriteMotionPresets) {
      if (!preset.prompts) continue;
      for (const { id } of SpriteBodyPlans) {
        const prompt = spriteMotionPrompt(preset, id);
        expect(prompt).toContain("end exactly in the starting pose");
        expect(prompt).not.toMatch(/breath|glow|lit up|both hands/i);
      }
    }
  });

  it("uses clip lengths gameasset.dev accepts", () => {
    for (const preset of SpriteMotionPresets) expect((preset.frames - 1) % 4).toBe(0);
  });

  it("starts each AI action from a fitting motion", () => {
    expect(presetForAction("idle")).toBe("idle");
    expect(presetForAction("move")).toBe("move");
    expect(presetForAction("basic:defensiveStance")).toBe("guard");
    expect(presetForAction("jutsu:abc")).toBe("strike");
  });
});
