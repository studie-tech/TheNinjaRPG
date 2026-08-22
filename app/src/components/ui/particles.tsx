"use client";

import type { Container, Engine, ISourceOptions } from "@tsparticles/engine";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocalStorage } from "@/hooks/localstorage";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useActiveLayout } from "@/utils/LayoutContext";

type ParticlesModule = typeof import("@tsparticles/react");

type LoadedParticles = {
  Particles: ParticlesModule["default"];
  ParticlesProvider: ParticlesModule["ParticlesProvider"];
  init: (engine: Engine) => Promise<void>;
};

let particlesLoader: Promise<LoadedParticles> | null = null;

const PARTICLE_COUNT_MAX = 200;
const PARTICLE_COUNT_MIN = 100;
const PARTICLE_COUNT_STEP = 25;
const PARTICLE_SAMPLE_MS = 1000;
const PARTICLE_LOW_FPS_THRESHOLD = 60;
const PARTICLE_RECOVERY_FPS_THRESHOLD = 60;
const PARTICLE_SLOW_FRAME_MS = 34;
const PARTICLE_LOW_SAMPLE_LIMIT = 2;
const PARTICLE_RECOVERY_SAMPLE_LIMIT = 6;

const PARTICLE_OPTIONS: ISourceOptions = {
  autoPlay: true,
  clear: true,
  fullScreen: {
    enable: true,
    zIndex: 0,
  },
  detectRetina: false,
  pauseOnBlur: true,
  pauseOnOutsideViewport: true,
  fpsLimit: 15,
  interactivity: {
    events: {
      onClick: { enable: false },
      onHover: { enable: false },
      resize: { enable: true },
    },
  },
  particles: {
    number: { value: PARTICLE_COUNT_MAX },
    color: { value: "#ffffff" },
    shape: { type: "circle" },
    opacity: {
      value: { min: 0.1, max: 0.5 },
    },
    size: {
      value: { min: 1, max: 2 },
    },
    move: {
      enable: true,
      speed: 0.3,
      direction: "top",
      straight: true,
      outModes: "out",
    },
    collisions: { enable: false },
  },
};

const setAdaptiveParticleCount = (container: Container, nextCount: number) => {
  const targetCount = Math.max(
    PARTICLE_COUNT_MIN,
    Math.min(PARTICLE_COUNT_MAX, nextCount),
  );
  const currentCount = container.particles.count;

  container.actualOptions.particles.number.value = targetCount;

  if (currentCount > targetCount) {
    container.particles.removeQuantity(currentCount - targetCount);
  } else if (currentCount < targetCount) {
    container.particles.push(targetCount - currentCount);
  }

  return targetCount;
};

const loadParticles = () => {
  particlesLoader ??= Promise.all([
    import("@tsparticles/react"),
    import("@tsparticles/slim"),
  ]).then(([particlesModule, slimModule]) => ({
    Particles: particlesModule.default,
    ParticlesProvider: particlesModule.ParticlesProvider,
    // Memoizing the promise keeps this callback referentially stable, which
    // ParticlesProvider requires for the lifetime of the app.
    init: async (engine: Engine) => {
      await slimModule.loadSlim(engine);
    },
  }));
  return particlesLoader;
};

const ParticleProvider = () => {
  const [particles, setParticles] = useState<LoadedParticles | null>(null);
  const [particlesContainer, setParticlesContainer] = useState<Container>();
  const particleContainerRef = useRef<Container | undefined>(undefined);
  const adaptiveParticleCountRef = useRef(PARTICLE_COUNT_MAX);
  const scrollResumeTimerRef = useRef<number | null>(null);
  const activeLayout = useActiveLayout();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [lightLayout] = useLocalStorage<boolean>("lightLayout", false);
  const shouldRender = isDesktop && !lightLayout && !reducedMotion;
  const pauseWhileScrolling = activeLayout === "pixel";

  // this should be run only once per application lifetime
  useEffect(() => {
    if (!shouldRender) {
      setParticles(null);
      setParticlesContainer(undefined);
      particleContainerRef.current = undefined;
      return;
    }

    let isCancelled = false;
    loadParticles()
      .then((loaded) => {
        if (!isCancelled) setParticles(loaded);
      })
      .catch((error) => {
        console.error("Failed to initialize particles engine:", error);
      });

    return () => {
      isCancelled = true;
    };
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender || !particlesContainer) return;

    let animationFrameId = 0;
    let lastFrameTime = 0;
    let sampleStartTime = 0;
    let frameCount = 0;
    let slowFrameCount = 0;
    let lowSampleCount = 0;
    let recoverySampleCount = 0;

    const resetSample = (timestamp: number) => {
      lastFrameTime = timestamp;
      sampleStartTime = timestamp;
      frameCount = 0;
      slowFrameCount = 0;
    };

    const tick = (timestamp: number) => {
      if (
        document.hidden ||
        particlesContainer.destroyed ||
        !particlesContainer.animationStatus
      ) {
        resetSample(timestamp);
        animationFrameId = window.requestAnimationFrame(tick);
        return;
      }

      if (!lastFrameTime) {
        resetSample(timestamp);
        animationFrameId = window.requestAnimationFrame(tick);
        return;
      }

      const frameDuration = timestamp - lastFrameTime;
      lastFrameTime = timestamp;

      if (frameDuration > 500) {
        resetSample(timestamp);
        animationFrameId = window.requestAnimationFrame(tick);
        return;
      }

      frameCount += 1;
      if (frameDuration > PARTICLE_SLOW_FRAME_MS) {
        slowFrameCount += 1;
      }

      const sampleDuration = timestamp - sampleStartTime;

      if (sampleDuration >= PARTICLE_SAMPLE_MS) {
        const fps = (frameCount * 1000) / sampleDuration;
        const slowFrameRatio = slowFrameCount / frameCount;
        const isLowFrameHealth =
          fps < PARTICLE_LOW_FPS_THRESHOLD || slowFrameRatio > 0.2;
        const isRecovered =
          fps >= PARTICLE_RECOVERY_FPS_THRESHOLD && slowFrameRatio < 0.05;

        if (isLowFrameHealth) {
          lowSampleCount += 1;
          recoverySampleCount = 0;
        } else if (isRecovered) {
          recoverySampleCount += 1;
          lowSampleCount = 0;
        } else {
          lowSampleCount = 0;
          recoverySampleCount = 0;
        }

        if (
          lowSampleCount >= PARTICLE_LOW_SAMPLE_LIMIT &&
          adaptiveParticleCountRef.current > PARTICLE_COUNT_MIN
        ) {
          adaptiveParticleCountRef.current = setAdaptiveParticleCount(
            particlesContainer,
            adaptiveParticleCountRef.current - PARTICLE_COUNT_STEP,
          );
          lowSampleCount = 0;
        } else if (
          recoverySampleCount >= PARTICLE_RECOVERY_SAMPLE_LIMIT &&
          adaptiveParticleCountRef.current < PARTICLE_COUNT_MAX
        ) {
          adaptiveParticleCountRef.current = setAdaptiveParticleCount(
            particlesContainer,
            adaptiveParticleCountRef.current + PARTICLE_COUNT_STEP,
          );
          recoverySampleCount = 0;
        }

        resetSample(timestamp);
      }

      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [particlesContainer, shouldRender]);

  useEffect(() => {
    if (!shouldRender || !pauseWhileScrolling) return;

    const handleScroll = () => {
      const container = particleContainerRef.current;
      container?.pause();

      if (scrollResumeTimerRef.current) {
        window.clearTimeout(scrollResumeTimerRef.current);
      }

      scrollResumeTimerRef.current = window.setTimeout(() => {
        particleContainerRef.current?.play();
        scrollResumeTimerRef.current = null;
      }, 180);
    };

    window.addEventListener("scroll", handleScroll, { capture: true, passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll, { capture: true });
      if (scrollResumeTimerRef.current) {
        window.clearTimeout(scrollResumeTimerRef.current);
        scrollResumeTimerRef.current = null;
      }
      particleContainerRef.current?.play();
    };
  }, [pauseWhileScrolling, shouldRender]);

  const handleParticlesLoaded = useCallback(async (container?: Container) => {
    particleContainerRef.current = container;
    adaptiveParticleCountRef.current = PARTICLE_COUNT_MAX;
    setParticlesContainer(container);
  }, []);

  if (!shouldRender || !particles) return null;

  const { Particles, ParticlesProvider } = particles;

  return (
    <ParticlesProvider init={particles.init}>
      <Particles
        id="tsparticles"
        options={PARTICLE_OPTIONS}
        particlesLoaded={handleParticlesLoaded}
      />
    </ParticlesProvider>
  );
};

export default ParticleProvider;
