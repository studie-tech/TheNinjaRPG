import { Eye, Search } from "lucide-react";
import type React from "react";
import { Progress } from "@/components/ui/progress";
import { STEALTH_SENSORY_CAP } from "@/drizzle/constants";
import type { getStealthStatus } from "@/libs/stealth";

/** A covert skill's progress and derived stats, with optional training actions beside them. */
export const CovertStatCard: React.FC<{
  kind: "stealth" | "sensory";
  status: ReturnType<typeof getStealthStatus>;
  actions?: React.ReactNode;
}> = ({ kind, status, actions }) => {
  const value = kind === "stealth" ? status.stealth : status.sensory;
  const stats = (
    <>
      <div className="mb-1 flex justify-between">
        <span className="text-sm">Progress</span>
        <span className="font-medium text-sm">
          {Math.floor(value).toLocaleString()} / {STEALTH_SENSORY_CAP.toLocaleString()}
        </span>
      </div>
      <Progress value={(value / STEALTH_SENSORY_CAP) * 100} className="h-2" />
      {kind === "stealth" ? (
        <div className="mt-3 space-y-1 text-muted-foreground text-sm">
          <p>Duration: {Math.floor(status.stealthDurationMax / 60)} min</p>
          <p>Keep Chance: {status.stealthKeepChance.toFixed(1)}%</p>
        </div>
      ) : (
        <div className="mt-3 space-y-1 text-muted-foreground text-sm">
          <p>Detection Chance: {status.sensoryDetectChance.toFixed(1)}%</p>
          <p>Cooldown: {Math.floor(status.sensoryCooldown)} sec</p>
        </div>
      )}
    </>
  );
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        {kind === "stealth" ? (
          <Eye className="h-5 w-5 text-purple-600" />
        ) : (
          <Search className="h-5 w-5 text-blue-600" />
        )}
        <h3 className="font-bold text-lg">
          {kind === "stealth" ? "Stealth" : "Sensory"}
        </h3>
      </div>
      {actions ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>{stats}</div>
          <div className="flex flex-col gap-2">{actions}</div>
        </div>
      ) : (
        stats
      )}
    </div>
  );
};
