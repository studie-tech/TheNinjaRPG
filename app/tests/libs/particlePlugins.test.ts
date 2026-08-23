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
});
