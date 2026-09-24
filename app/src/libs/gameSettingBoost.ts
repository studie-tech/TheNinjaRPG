import type { GameSetting } from "@/drizzle/schema";
import { round } from "@/utils/math";
import { secondsPassed } from "@/utils/time";

/**
 * Convenience method for fetching a current value boost from the settings if still active,
 * otherwise return null
 * @param settingName
 * @param settings
 */
export const getGameSettingBoost = (settingName: string, settings: GameSetting[]) => {
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
