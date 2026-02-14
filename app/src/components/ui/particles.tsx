"use client";

import Particles, { initParticlesEngine } from "@tsparticles/react";
import { loadSlim } from "@tsparticles/slim";
import { useEffect, useState } from "react";
import { useLocalStorage } from "@/hooks/localstorage";
import { useMediaQuery } from "@/hooks/useMediaQuery";

const ParticleProvider = () => {
  const [init, setInit] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const [lightLayout] = useLocalStorage<boolean>("lightLayout", false);

  // this should be run only once per application lifetime
  useEffect(() => {
    if (lightLayout) return;
    initParticlesEngine(async (engine) => {
      // you can initiate the tsParticles instance (engine) here, adding custom shapes or presets
      // this loads the tsparticles package bundle, it's the easiest method for getting everything ready
      // starting from v2 you can add only the features you need reducing the bundle size
      //await loadAll(engine);
      //await loadFull(engine);
      await loadSlim(engine);
      //await loadBasic(engine);
    })
      .then(() => {
        setInit(true);
      })
      .catch((error) => {
        console.error("Failed to initialize particles engine:", error);
      });
  }, [lightLayout]);

  return (
    <>
      {init && isDesktop && !lightLayout && (
        <Particles
          id="tsparticles"
          options={{
            autoPlay: true,
            clear: true,
            fullScreen: {
              enable: true,
              zIndex: 0,
            },
            detectRetina: false,
            pauseOnBlur: true,
            pauseOnOutsideViewport: true,
            fpsLimit: 30,
            interactivity: {
              events: {
                onClick: { enable: false },
                onHover: { enable: false },
                resize: { enable: true },
              },
            },
            particles: {
              number: { value: 200 },
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
                direction: "top" as const,
                straight: true,
                outModes: "out" as const,
              },
              collisions: { enable: false },
            },
          }}
        />
      )}
    </>
  );
};

export default ParticleProvider;
