import type React from "react";
import StatusBar, { type StatusBarProps } from "@/layout/StatusBar";

interface PoolStatusBarsProps
  extends Pick<
    StatusBarProps,
    "status" | "regen" | "lastRegenAt" | "timeDiff" | "timedBuffs"
  > {
  pools: {
    [Pool in (typeof POOL_BARS)[number]["pool"] as
      | `cur${Pool}`
      | `max${Pool}`]?: number;
  };
  /** Remount a bar when its pool changes instead of letting it carry its regen state. */
  remountOnChange?: boolean;
}

/**
 * The HP, CP and SP bars in display order. Every prop except `pools` and
 * `remountOnChange` reaches all three bars unchanged.
 */
export const PoolStatusBars: React.FC<PoolStatusBarsProps> = ({
  pools,
  remountOnChange,
  ...barProps
}) => (
  <>
    {POOL_BARS.map(({ pool, title, color }) => {
      const current = pools[`cur${pool}`];
      const total = pools[`max${pool}`];
      return (
        <StatusBar
          key={remountOnChange ? `${title}-${current}-${total}` : title}
          {...barProps}
          title={title}
          tooltip={pool}
          color={color}
          showText={true}
          current={current}
          total={total}
        />
      );
    })}
  </>
);

const POOL_BARS = [
  { pool: "Health", title: "HP", color: "bg-red-500" },
  { pool: "Chakra", title: "CP", color: "bg-blue-500" },
  { pool: "Stamina", title: "SP", color: "bg-green-500" },
] as const;
