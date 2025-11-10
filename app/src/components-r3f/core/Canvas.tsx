"use client";

import React, { useMemo } from "react";
import { Canvas as R3FCanvas } from "@react-three/fiber";

interface BaseCanvasProps {
  type: "combat" | "sector" | "map";
  width: number;
  height: number;
  backgroundColor?: string | number;
  backgroundAlpha?: number;
  children: React.ReactNode;
  className?: string;
}

/**
 * Base Canvas component for all R3F scenes
 * Provides common setup and configuration for Combat, Sector, and Map scenes
 */
export const BaseCanvas: React.FC<BaseCanvasProps> = ({
  type,
  width,
  height,
  backgroundColor = 0x000000,
  backgroundAlpha = 1,
  children,
  className = "",
}) => {
  // Convert color to CSS if needed
  const bgColor = useMemo(() => {
    if (typeof backgroundColor === "number") {
      return `#${backgroundColor.toString(16).padStart(6, "0")}`;
    }
    return backgroundColor;
  }, [backgroundColor]);

  const style = useMemo(
    () => ({
      width: `${width}px`,
      height: `${height}px`,
      background: backgroundAlpha < 1 ? "transparent" : bgColor,
    }),
    [width, height, bgColor, backgroundAlpha],
  );

  return (
    <R3FCanvas
      className={className}
      style={style}
      gl={{
        preserveDrawingBuffer: true,
        antialias: true,
        alpha: backgroundAlpha < 1,
      }}
      dpr={[1, 2]} // Use device pixel ratio for sharper rendering
      frameloop="always"
    >
      {children}
    </R3FCanvas>
  );
};

// Simple Canvas export for map/other scenes
export const Canvas: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <R3FCanvas
      gl={{
        preserveDrawingBuffer: true,
        antialias: true,
      }}
      dpr={[1, 2]}
      frameloop="always"
    >
      {children}
    </R3FCanvas>
  );
};

export default BaseCanvas;

