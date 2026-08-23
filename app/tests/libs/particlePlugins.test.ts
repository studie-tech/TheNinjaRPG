import { describe, expect, it } from "vitest";
import { registerParticlePlugins } from "@/libs/particlePlugins";

describe("registerParticlePlugins", () => {
  it("leaves confetti able to register after the background has loaded the engine", async () => {
    const { tsParticles } = await import("@tsparticles/engine");
    const { confetti } = await import("@tsparticles/confetti");

    await registerParticlePlugins();
    // The first thing load() does, and it closes registration permanently.
    await tsParticles.init();

    // Registering only slim here is what production did, and this call then threw
    // "Register plugins can only be done before calling tsParticles.load()" on every
    // reward toast for the rest of the page's life.
    await expect(confetti.init()).resolves.toBeUndefined();
  });

  it("still registers the background's own shapes on the same engine", async () => {
    const { tsParticles } = await import("@tsparticles/engine");

    await registerParticlePlugins();
    await tsParticles.init();

    const drawers = await tsParticles.pluginManager.getShapeDrawers({} as never, true);
    // From loadSlim - the particle background draws these.
    expect(drawers.has("circle")).toBe(true);
    expect(drawers.has("triangle")).toBe(true);
    // From confetti, proving both land on the one singleton rather than two engines.
    expect(drawers.has("heart")).toBe(true);
  });
});
