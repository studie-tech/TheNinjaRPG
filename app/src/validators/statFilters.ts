import { LetterRanks } from "@/drizzle/constants";

export const statFilters = [
  "Highest",
  "Ninjutsu",
  "Genjutsu",
  "Taijutsu",
  "Bukijutsu",
  "Strength",
  "Intelligence",
  "Willpower",
  "Speed",
] as const;
export const rarities = ["ALL", ...LetterRanks] as const;
/** Quick filters over the stat a jutsu scales with; "Highest" jutsu use the user's best stat. */
export const jutsuStatQuickFilters = [
  "All",
  "Ninjutsu",
  "Genjutsu",
  "Taijutsu",
  "Bukijutsu",
  "Highest",
] as const satisfies readonly ("All" | (typeof statFilters)[number])[];
export type JutsuStatQuickFilter = (typeof jutsuStatQuickFilters)[number];

/** The quick filter matching a stat selection, or null for a custom selection. */
export const getJutsuStatQuickFilter = (
  stat: readonly string[] | undefined,
): JutsuStatQuickFilter | null => {
  if (!stat?.length) return "All";
  const [only] = stat;
  if (stat.length !== 1 || only === "All") return null;
  return jutsuStatQuickFilters.find((option) => option === only) ?? null;
};

/** The stat selection a quick filter applies. */
export const jutsuStatQuickFilterSelection = (
  quickFilter: JutsuStatQuickFilter,
): StatGenType[] => (quickFilter === "All" ? [] : [quickFilter]);

export type StatGenType = (typeof statFilters)[number];
