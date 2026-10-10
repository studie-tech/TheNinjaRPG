import {
  BLUE_BLADE_EYES_BLOODLINE_ID,
  HEAVENLY_SONATA_BLOODLINE_ID,
  MUSIC_AKASUMI_THEME,
  MUSIC_AKIKAZE_THEME,
  MUSIC_ANOTHER_DAY_ANOTHER_BATTLEFIELD,
  MUSIC_BLUE_BLADE_THEME,
  MUSIC_HALLOWEEN_THEME,
  MUSIC_HEAVENLY_SONATA_THEME,
  MUSIC_HORIZON_THEME,
  MUSIC_HYORIN_THEME,
  MUSIC_SHIROHANA_THEME,
  MUSIC_SYNDICATE_THEME,
  MUSIC_TSUKIMORI_THEME,
  MUSIC_WELCOME_TO_SEICHI,
  MUSIC_WINTER_THEME,
} from "@/drizzle/constants";
import { getCurrentSeason } from "@/utils/time";

type Season = ReturnType<typeof getCurrentSeason>;

/** The parts of a user that decide which background theme plays */
export type BackgroundMusicUser = {
  villageName?: string | null;
  isOutlaw?: boolean | null;
  bloodlineId?: string | null;
  /** True while the user is in any battle, PvE or PvP (`UserData.status === "BATTLE"`) */
  inBattle?: boolean | null;
};

/** Background theme per village name; any other village (or none) hears Welcome to Seichi */
const VILLAGE_MUSIC = new Map<string, string>([
  ["Tsukimori", MUSIC_TSUKIMORI_THEME],
  ["Shirohana", MUSIC_SHIROHANA_THEME],
  ["Akikaze", MUSIC_AKIKAZE_THEME],
  ["Akasumi", MUSIC_AKASUMI_THEME],
  ["Hyorin", MUSIC_HYORIN_THEME],
  ["Horizon", MUSIC_HORIZON_THEME],
]);

/** Bloodline themes, keyed by bloodline id */
const BLOODLINE_MUSIC = new Map<string, string>([
  [HEAVENLY_SONATA_BLOODLINE_ID, MUSIC_HEAVENLY_SONATA_THEME],
  [BLUE_BLADE_EYES_BLOODLINE_ID, MUSIC_BLUE_BLADE_THEME],
]);

/** Event themes that replace non-battle themes while their season lasts */
const SEASON_MUSIC: Partial<Record<Season, string>> = {
  halloween: MUSIC_HALLOWEEN_THEME,
  winter: MUSIC_WINTER_THEME,
};

/**
 * Pick the background music track, in priority order: battle theme (Another
 * day, Another battlefield, for every PvE and PvP fight), seasonal event theme,
 * bloodline theme, outlaw theme (for every outlaw, whether their village is the
 * Syndicate, a hideout or a town), village theme, then Welcome to Seichi.
 * Seasons follow `getCurrentSeason`, the same calendar that switches the
 * seasonal wallpapers, so event music and artwork agree.
 * Halloween music requires a loaded user; visitors hear Welcome to Seichi.
 */
export const getBackgroundMusicSrc = (
  user?: BackgroundMusicUser | null,
  season: Season = getCurrentSeason(),
): string => {
  if (user?.inBattle) return MUSIC_ANOTHER_DAY_ANOTHER_BATTLEFIELD;
  const seasonal = season === "halloween" && !user ? undefined : SEASON_MUSIC[season];
  if (seasonal) return seasonal;
  const bloodline = BLOODLINE_MUSIC.get(user?.bloodlineId ?? "");
  if (bloodline) return bloodline;
  if (user?.isOutlaw) return MUSIC_SYNDICATE_THEME;
  return VILLAGE_MUSIC.get(user?.villageName ?? "") ?? MUSIC_WELCOME_TO_SEICHI;
};
