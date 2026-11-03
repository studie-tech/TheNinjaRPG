import { cva, type VariantProps } from "class-variance-authority";
import type React from "react";
import { cn } from "@/libs/shadui";

const durabilityBarVariants = cva(
  "absolute rounded-sm border border-gray-600 bg-gray-800",
  {
    variants: {
      position: {
        "top-right": "top-1 right-1",
        "top-left": "top-1 left-1",
      },
      size: {
        medium: "h-12 w-1.5",
        large: "h-16 w-2",
      },
    },
    defaultVariants: {
      position: "top-right",
      size: "medium",
    },
  },
);

interface DurabilityBarProps extends VariantProps<typeof durabilityBarVariants> {
  /** Current durability value */
  currentDurability: number;
  /** Maximum durability value; nothing renders unless it is positive */
  maxDurability: number;
}

export const DurabilityBar: React.FC<DurabilityBarProps> = ({
  currentDurability,
  maxDurability,
  position,
  size,
}) => {
  if (maxDurability <= 0) return null;

  // Calculate durability percentage
  const durabilityPercentage = Math.max(
    0,
    Math.min(100, (currentDurability / maxDurability) * 100),
  );

  // Color based on durability percentage
  const getColor = () => {
    if (durabilityPercentage > 50) return "bg-green-500";
    if (durabilityPercentage > 25) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className={durabilityBarVariants({ position, size })}>
      <div
        className={cn("w-full rounded-sm transition-all duration-300", getColor())}
        style={{
          height: `${durabilityPercentage}%`,
          position: "absolute",
          bottom: 0,
        }}
      />
    </div>
  );
};

export default DurabilityBar;
