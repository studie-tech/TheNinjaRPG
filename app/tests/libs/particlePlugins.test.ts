import { describe, expect, it } from "bun:test";
import { registerParticlePlugins } from "@/libs/particlePlugins";

describe("registerParticlePlugins", () => {
  it("leaves confetti able to register after the background has loaded the engine", async () => {
    const { tsParticles } = await import("@tsparticles/engine");
    const { confetti } = await import("@tsparticles/confetti");

    await registerParticlePlugins();
    // Loading closes registration permanently.
    await tsParticles.init();

    await expect(confetti.init()).resolves.toBeUndefined();
  });

  it("still registers the background's own shapes on the same engine", async () => {
    const { tsParticles } = await import("@tsparticles/engine");

    await registerParticlePlugins();
    await tsParticles.init();

    const drawers = tsParticles.pluginManager.initializers.shapes;
    // Background shapes and reward shapes share the registered engine.
    expect(drawers.has("circle")).toBe(true);
    expect(drawers.has("triangle")).toBe(true);
    expect(drawers.has("heart")).toBe(true);
  });
});
