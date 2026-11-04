let registration: Promise<void> | null = null;

/**
 * Background circles and reward confetti share one engine. Confetti includes the basic
 * shapes, movement, opacity and size plugins used by the background. Register this set
 * once before either consumer loads the engine, which closes plugin registration.
 */
export const registerParticlePlugins = (): Promise<void> => {
  registration ??= (async () => {
    const { confetti } = await import("@tsparticles/confetti");
    await confetti.init();
  })();
  return registration;
};
