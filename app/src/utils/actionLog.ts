import { ACTION_LOG_RELATED_MSG_MAX_LENGTH } from "@/drizzle/constants";

/**
 * Clamp free text to fit the `ActionLog.relatedText` varchar(191) column.
 *
 * MySQL counts varchar length in characters (code points), so this truncates by
 * code point rather than UTF-16 unit; a plain `.slice()` can cut an emoji in
 * half and leave a lone surrogate that the database rejects.
 */
export const clampActionLogText = (
  text: string,
  maxLength: number = ACTION_LOG_RELATED_MSG_MAX_LENGTH,
): string => {
  if (text.length <= maxLength) return text;
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return chars.slice(0, maxLength).join("");
};
