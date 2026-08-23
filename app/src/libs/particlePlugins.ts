let registration: Promise<void> | null = null;

/**
 * The particle background and the confetti helper drive the same tsParticles singleton,
 * and its PluginManager rejects every registration once the first load() has run - so
 * whichever of the two started second threw "Register plugins can only be done before
 * calling tsParticles.load()". Routing both through this one memoized call registers
 * everything up front, leaving either free to load first.
 */
export const registerParticlePlugins = (): Promise<void> => {
  registration ??= (async () => {
    const [{ tsParticles }, { loadSlim }, { confetti }] = await Promise.all([
      import("@tsparticles/engine"),
      import("@tsparticles/slim"),
      import("@tsparticles/confetti"),
    ]);
    await loadSlim(tsParticles);
    // Registers confetti's own plugins without loading anything.
    await confetti.init();
  })();
  return registration;
};
