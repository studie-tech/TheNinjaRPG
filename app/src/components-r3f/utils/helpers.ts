"use client";

import { Color } from "three";

/**
 * Convert hex color to Three.js Color
 */
export function hexToColor(hex: string | number): Color {
  if (typeof hex === "number") {
    return new Color(hex);
  }
  return new Color(hex);
}

/**
 * Create vertices array from points for BufferGeometry
 */
export function createVertices(points: { x: number; y: number; z: number }[]): Float32Array {
  const vertices: number[] = [];
  points.forEach((point) => {
    vertices.push(point.x, point.y, point.z);
  });
  return new Float32Array(vertices);
}

/**
 * Calculate hex tile color based on type
 */
export function getHexColor(type: "ocean" | "ground" | "desert" | "ice"): string {
  const oceanColors = ["#1a5490", "#1e6bb8", "#2182df"];
  const groundColors = ["#4a7c59", "#5d8a6b", "#70987d"];
  const desertColors = ["#c2a878", "#d4ba88", "#e6cc98"];
  const iceColors = ["#d0e8f2", "#e0f0f8", "#f0f8fc"];

  const colors = {
    ocean: oceanColors,
    ground: groundColors,
    desert: desertColors,
    ice: iceColors,
  };

  const colorArray = colors[type];
  return colorArray[Math.floor(Math.random() * colorArray.length)] ?? colorArray[0] ?? "#ffffff";
}

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Lerp (linear interpolation) between two values
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

