"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { FishingSimulationState } from "@/libs/fishing/simulation";

type FishingCanvasProps = {
  simulation: FishingSimulationState | null;
  aim: { x: number; y: number };
  onAim: (point: { x: number; y: number }) => void;
  active: boolean;
};

export type FishingCanvasHandle = {
  updateSimulation: (simulation: FishingSimulationState) => void;
};

export const FishingCanvas = forwardRef<FishingCanvasHandle, FishingCanvasProps>(
  function FishingCanvas({ simulation, aim, onAim, active }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const simulationRef = useRef(simulation);
    const aimRef = useRef(aim);
    const onAimRef = useRef(onAim);
    simulationRef.current = simulation;
    aimRef.current = aim;
    onAimRef.current = onAim;
    useImperativeHandle(ref, () => ({
      updateSimulation: (nextSimulation) => {
        simulationRef.current = nextSimulation;
      },
    }));

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      let disposed = false;
      let destroy = () => undefined;
      void (async () => {
        const { Application, Assets, Container, Graphics, Sprite } = await import(
          "pixi.js"
        );
        if (disposed) return;
        const app = new Application();
        await app.init({
          antialias: true,
          backgroundAlpha: 0,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
        });
        if (disposed) {
          app.destroy(true);
          return;
        }
        host.appendChild(app.canvas);
        app.canvas.className = "h-full w-full touch-none";
        app.canvas.setAttribute("aria-hidden", "true");
        const scene = new Container();
        app.stage.addChild(scene);
        const [backgroundTexture, fishTexture] = await Promise.all([
          Assets.load("/fishing/riverbank-day-v1.png"),
          Assets.load("/fishing/river-carp-v1.png"),
        ]);
        const background = new Sprite(backgroundTexture);
        background.width = 1000;
        background.height = 1000;
        scene.addChild(background);
        const waterShade = new Graphics()
          .rect(0, 0, 1000, 735)
          .fill({ color: 0x0b7898, alpha: 0.12 });
        scene.addChild(waterShade);
        const school = new Graphics();
        const line = new Graphics();
        const player = new Graphics()
          .circle(500, 910, 28)
          .fill({ color: 0x172033 })
          .circle(500, 872, 17)
          .fill({ color: 0xe7b978 })
          .moveTo(515, 875)
          .lineTo(555, 805)
          .stroke({ color: 0x49311f, width: 7 });
        const fish = new Sprite(fishTexture);
        fish.anchor.set(0.5);
        fish.width = 118;
        fish.height = 78;
        const bobber = new Graphics();
        const target = new Graphics();
        scene.addChild(school, fish, line, bobber, player, target);

        const prefersReducedMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;
        const displayFish = { x: 500, y: 300 };
        const displayLure = { x: 500, y: 300 };
        app.ticker.add(() => {
          const state = simulationRef.current;
          const targetPoint = state?.lure ?? {
            x: aimRef.current.x * 1000,
            y: aimRef.current.y * 735,
          };
          const smoothing = prefersReducedMotion ? 1 : 0.22;
          displayLure.x += (targetPoint.x - displayLure.x) * smoothing;
          displayLure.y += (targetPoint.y - displayLure.y) * smoothing;
          if (state) {
            displayFish.x += (state.fish.x - displayFish.x) * smoothing;
            displayFish.y += (state.fish.y - displayFish.y) * smoothing;
            fish.position.set(displayFish.x, displayFish.y);
            fish.rotation = Math.atan2(state.fish.velocityY, state.fish.velocityX);
            fish.scale.x =
              state.fish.velocityX < 0
                ? -Math.abs(fish.scale.x)
                : Math.abs(fish.scale.x);
            fish.alpha =
              state.phase === "ATTRACT" ? 0.28 : state.phase === "BITE" ? 0.58 : 0.88;
            fish.tint = state.phase === "LANDED" ? 0xffffff : 0x0d5266;
            school.clear();
            if (state.school) {
              school
                .circle(state.school.x, state.school.y, 54)
                .stroke({ color: 0x8de7ef, width: 3, alpha: 0.65 })
                .circle(state.school.x - 24, state.school.y + 14, 5)
                .fill({ color: 0xdafcff, alpha: 0.7 })
                .circle(state.school.x + 20, state.school.y - 10, 4)
                .fill({ color: 0xdafcff, alpha: 0.7 });
            }
          } else {
            fish.alpha = 0;
            school.clear();
          }
          bobber
            .clear()
            .circle(displayLure.x, displayLure.y, 11)
            .fill({ color: 0xffffff })
            .rect(displayLure.x - 10, displayLure.y - 2, 20, 8)
            .fill({ color: 0xf14343 });
          const tension = state?.line.tension ?? 0;
          const lineColor =
            tension > 82 ? 0xef4444 : tension > 58 ? 0xf59e0b : 0xe8f7ff;
          line
            .clear()
            .moveTo(555, 805)
            .quadraticCurveTo(660, 700 - tension * 0.7, displayLure.x, displayLure.y)
            .stroke({ color: lineColor, width: tension > 82 ? 4 : 2, alpha: 0.92 });
          target.clear();
          if (!state) {
            target
              .circle(aimRef.current.x * 1000, aimRef.current.y * 735, 24)
              .stroke({ color: 0xffffff, width: 3, alpha: 0.9 })
              .circle(aimRef.current.x * 1000, aimRef.current.y * 735, 5)
              .fill({ color: 0xffffff, alpha: 0.9 });
          }
        });
        const resize = () => {
          const width = Math.max(320, host.clientWidth);
          const height = Math.max(260, host.clientHeight);
          app.renderer.resize(width, height);
          scene.scale.set(width / 1000, height / 1000);
        };
        const observer = new ResizeObserver(resize);
        observer.observe(host);
        resize();
        const pointFromEvent = (event: PointerEvent) => {
          const rect = app.canvas.getBoundingClientRect();
          onAimRef.current({
            x: Math.min(0.95, Math.max(0.05, (event.clientX - rect.left) / rect.width)),
            y: Math.min(0.98, Math.max(0.05, (event.clientY - rect.top) / rect.height)),
          });
        };
        let pointerDown = false;
        const down = (event: PointerEvent) => {
          pointerDown = true;
          app.canvas.setPointerCapture(event.pointerId);
          pointFromEvent(event);
        };
        const move = (event: PointerEvent) => {
          if (pointerDown) pointFromEvent(event);
        };
        const up = () => {
          pointerDown = false;
        };
        app.canvas.addEventListener("pointerdown", down);
        app.canvas.addEventListener("pointermove", move);
        app.canvas.addEventListener("pointerup", up);
        app.canvas.addEventListener("pointercancel", up);
        destroy = () => {
          observer.disconnect();
          app.canvas.removeEventListener("pointerdown", down);
          app.canvas.removeEventListener("pointermove", move);
          app.canvas.removeEventListener("pointerup", up);
          app.canvas.removeEventListener("pointercancel", up);
          app.destroy(true, { children: true, texture: false, textureSource: false });
        };
      })();
      return () => {
        disposed = true;
        destroy();
      };
    }, []);

    return (
      <div
        ref={hostRef}
        role="application"
        aria-label={
          active
            ? "Fishing water. Drag to steer the rod."
            : "Fishing water. Tap or drag to choose a cast target."
        }
        className="relative aspect-[4/3] min-h-72 w-full overflow-hidden rounded-xl border bg-sky-950 shadow-inner"
      />
    );
  },
);
