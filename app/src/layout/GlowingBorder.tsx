"use client";

import type React from "react";
import { cn } from "@/libs/shadui";

interface GlowingBorderProps {
  children: React.ReactNode;
  messageCount: number | null | undefined;
  className?: string;
}

const GlowingBorder: React.FC<GlowingBorderProps> = ({
  children,
  messageCount,
  className,
}) => {
  // Calculate animation speed based on message count (faster for higher counts)
  // Cap at 500 messages as mentioned in requirements
  const normalizedCount = Math.min(messageCount || 0, 100);
  const animationDuration = 10 - (normalizedCount / 100) * 9; // Range from 10s to 1s

  // Determine color intensity based on message count
  let borderClass = "";

  if (normalizedCount < 25) {
    borderClass = "glow-border-low";
  } else if (normalizedCount < 50) {
    borderClass = "glow-border-medium";
  } else if (normalizedCount < 75) {
    borderClass = "glow-border-high";
  } else {
    borderClass = "glow-border-max";
  }

  return (
    <div className={cn("relative m-4 w-fit bg-red-500", className)}>
      <div
        className={cn("absolute rounded-2xl", borderClass)}
        style={{
          animation: `glowingBorder ${animationDuration}s linear infinite`,
          top: "0px",
          right: "0px",
          bottom: "0px",
          left: "0px",
          zIndex: 0,
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
};

export default GlowingBorder;
