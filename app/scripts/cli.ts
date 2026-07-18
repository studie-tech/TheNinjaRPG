/**
 * Tiny shared CLI helpers for the map scripts (script-only; never imported by
 * app code, so it lives here rather than in src/utils).
 */

/** Value following a `--flag` in argv, or undefined if the flag is absent */
export const getFlagValue = (argv: string[], flag: string) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};

/**
 * Parse a comma-separated integer list ("1, 2,3"). Empty segments are dropped
 * BEFORE coercion - `Number("") === 0`, so without this an omitted flag would
 * silently parse to [0] instead of [].
 */
export const parseIntList = (value: string | undefined) => {
  return (value ?? "")
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map(Number)
    .filter((parsed) => Number.isInteger(parsed));
};
