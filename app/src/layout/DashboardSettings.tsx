"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  dashboardContentGroupLabels,
  getDashboardContentPriority,
} from "@/libs/profileDashboard";
import type { UserWithRelations } from "@/server/api/routers/profile";

export function DashboardSettings({
  userData,
  updateUser,
}: {
  userData: NonNullable<UserWithRelations>;
  updateUser?: (data: Partial<UserWithRelations>) => Promise<void>;
}) {
  const utils = api.useUtils();
  const [priority, setPriority] = useState(() =>
    getDashboardContentPriority(userData.dashboardContentPriority),
  );
  const [remember, setRemember] = useState(userData.rememberProfileTab);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    setPriority(getDashboardContentPriority(userData.dashboardContentPriority));
    setRemember(userData.rememberProfileTab);
  }, [userData.userId, userData.dashboardContentPriority, userData.rememberProfileTab]);
  const save = api.profile.updatePreferences.useMutation({
    onSuccess: async (result, input) => {
      if (!result.success) {
        setMessage(result.message);
        return;
      }
      if (updateUser) await updateUser(input);
      else await utils.profile.getUser.invalidate();
      setMessage("Dashboard preferences saved.");
    },
    onError: (error) => setMessage(error.message),
  });
  const savedPriority = getDashboardContentPriority(userData.dashboardContentPriority);
  const hasChanges =
    remember !== userData.rememberProfileTab ||
    priority.some((group, index) => group !== savedPriority[index]);
  const move = (index: number, direction: -1 | 1) => {
    const next = [...priority];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [group] = next.splice(index, 1);
    if (group) next.splice(target, 0, group);
    setPriority(next);
    setMessage(null);
  };
  return (
    <section className="space-y-3" aria-label="Dashboard preferences">
      <p className="font-bold text-lg">Dashboard</p>
      <p className="text-muted-foreground text-xs">
        Upcoming content priority: higher types appear first. Unavailable types are
        skipped; all eligible content remains accessible.
      </p>
      <ol className="space-y-1">
        {priority.map((group, index) => (
          <li
            key={group}
            className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm"
          >
            <span>
              {index + 1}. {dashboardContentGroupLabels[group]}
            </span>
            <div className="flex shrink-0 gap-1">
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={save.isPending || index === 0}
                aria-label={`Move ${dashboardContentGroupLabels[group]} up`}
                onClick={() => move(index, -1)}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                disabled={save.isPending || index === priority.length - 1}
                aria-label={`Move ${dashboardContentGroupLabels[group]} down`}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="h-4 w-4" />
              </Button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm">Remember profile tab</p>
          <p className="text-muted-foreground text-xs">
            Off by default: return to Dashboard. When enabled, remember the last tab on
            this device.
          </p>
        </div>
        <Switch
          checked={remember}
          disabled={save.isPending}
          aria-label="Remember profile tab"
          onCheckedChange={(checked) => {
            setRemember(checked);
            setMessage(null);
          }}
        />
      </div>
      <Button
        disabled={save.isPending || !hasChanges}
        onClick={() => {
          setMessage(null);
          save.mutate({
            dashboardContentPriority: priority,
            rememberProfileTab: remember,
          });
        }}
      >
        {save.isPending ? "Saving..." : "Save dashboard preferences"}
      </Button>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
