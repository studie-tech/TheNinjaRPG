"use client";

import { useEffect, useRef } from "react";
import { useThree } from "@react-three/fiber";
import type { Vector2, Raycaster as ThreeRaycaster } from "three";

/**
 * Hook to get raycaster from mouse position
 * Replaces the manual setRaycasterFromMouse utility
 */
export function useRaycaster() {
  const { raycaster, camera, size } = useThree();
  const mouseRef = useRef<Vector2>({ x: 0, y: 0 } as Vector2);

  const updateMouse = (event: MouseEvent, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouseRef.current, camera);
  };

  return {
    raycaster,
    updateMouse,
    mouse: mouseRef.current,
  };
}

/**
 * Hook for managing hover state on 3D objects
 */
export function useHover<T extends THREE.Object3D>() {
  const [hovered, setHovered] = useState(false);

  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
  };

  const onPointerOut = () => {
    setHovered(false);
  };

  return {
    hovered,
    onPointerOver,
    onPointerOut,
  };
}

/**
 * Hook for responsive canvas sizing
 */
export function useCanvasSize(aspectRatio: number = 1) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const width = containerRef.current.clientWidth;
        const height = width * aspectRatio;
        setDimensions({ width, height });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);

    return () => {
      window.removeEventListener("resize", updateSize);
    };
  }, [aspectRatio]);

  return {
    containerRef,
    width: dimensions.width,
    height: dimensions.height,
  };
}

// Re-export common types for convenience
export type { Vector2, Vector3, Mesh, Group, Sprite } from "three";
export type { ThreeEvent } from "@react-three/fiber";

import { useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type * as THREE from "three";

