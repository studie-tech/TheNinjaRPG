import { describe, expect, it } from "bun:test";
import {
  presetForAction,
  SpriteBodyPlans,
  SpriteMotionPresets,
  spriteMotionPrompt,
} from "@/libs/spriteStudio";

describe("sprite studio presets", () => {
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
