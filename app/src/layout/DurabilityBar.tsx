import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "src/libs/shadui";

const durabilityBarVariants = cva(
  "absolute bg-gray-800 rounded-sm border border-gray-600",
  {
    variants: {
      position: {
        "top-right": "top-1 right-1",
        "top-left": "top-1 left-1",
      },
      size: {
        small: "h-8 w-1",
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

export interface DurabilityBarProps extends VariantProps<typeof durabilityBarVariants> {
  /** Current durability value */
  currentDurability: number;
  /** Maximum durability value */
  maxDurability: number;
  /** Additional CSS classes */
  className?: string;
}

export const DurabilityBar: React.FC<DurabilityBarProps> = ({
  currentDurability,
  maxDurability,
  position,
  size,
  className,
}) => {
  // Calculate durability percentage
  const durabilityPercentage = Math.max(
    0,
    Math.min(100, (currentDurability / maxDurability) * 100),
  );

  // Color based on durability percentage
  const getColor = () => {
    if (durabilityPercentage > 60) return "bg-green-500";
    if (durabilityPercentage > 30) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className={cn(durabilityBarVariants({ position, size, className }))}>
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
