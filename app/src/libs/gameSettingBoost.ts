import type { GameSetting } from "@/drizzle/schema";
import { round } from "@/utils/math";
import { secondsPassed } from "@/utils/time";
import type { ChangeSettingSchema } from "@/validators/misc";

/** Navigation and display labels for the global boosts editable by event staff. */
export const GLOBAL_GAME_BOOSTS = {
  trainingGainMultiplier: { href: "/traininggrounds", label: "gains" },
  regenGainMultiplier: { href: "/profile", label: "regen" },
  battleExpMultiplier: { href: "/battlearena", label: "battle exp" },
  missionExpMultiplier: { href: "/missionhall", label: "mission exp" },
  jutsuExpMultiplier: { href: "/jutsus", label: "jutsu exp" },
  itemExpMultiplier: { href: "/items", label: "item exp" },
} as const satisfies Record<EventGameSettingName, { href: string; label: string }>;

/**
 * Convenience method for fetching a current value boost from the settings if still active,
 * otherwise return null
 * @param settingName
 * @param settings
 */
export const getGameSettingBoost = (
  settingName: string,
  settings: Pick<GameSetting, "name" | "value" | "time">[],
) => {
  const setting = settings.find((s) => s.name === settingName);
  if (setting) {
    const secondsLeft = -secondsPassed(setting.time);
    const daysLeft = round(secondsLeft / (24 * 3600), 1);
    if (secondsLeft > 0 && setting.value > 0) {
      return { value: setting.value, daysLeft, secondsLeft };
    }
  }
  return null;
};

/** Multiply `value` by a game setting's boost while it is active. */
export const applyGameSettingMultiplier = (
  value: number,
  settingName: string,
  settings?: Pick<GameSetting, "name" | "value" | "time">[],
) => value * (getGameSettingBoost(settingName, settings ?? [])?.value ?? 1);

/** Format one saved global boost, or clear its notice when inactive or expired. */
export const getGlobalGameSettingNotification = (
  settingName: EventGameSettingName,
  setting?: Pick<GameSetting, "name" | "value" | "time">,
): GlobalBoostNotification | null => {
  const boost = getGameSettingBoost(settingName, setting ? [setting] : []);
  if (!boost) return null;
  const { href, label } = GLOBAL_GAME_BOOSTS[settingName];
  return {
    href,
    name: `Global: ${boost.value}X ${label} | ${boost.daysLeft} days`,
    color: "green",
    group: "Active boosts",
  };
};

/** List active global boost notices in the menu's stable setting order. */
export const getGlobalGameSettingNotifications = (settings: GameSetting[]) =>
  (Object.keys(GLOBAL_GAME_BOOSTS) as EventGameSettingName[]).flatMap((name) => {
    const notice = getGlobalGameSettingNotification(
      name,
      settings.find((setting) => setting.name === name),
    );
    return notice ? [notice] : [];
  });

/** Persisted event settings that provide global boost notices. */
export type EventGameSettingName = ChangeSettingSchema["setting"];
/** Display fields shared by canonical profiles and confirmed boost updates. */
export type GlobalBoostNotification = {
  href: string;
  name: string;
  color: "green";
  group: "Active boosts";
};
