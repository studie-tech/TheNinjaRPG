/**
 * Regular expression for matching date-time strings in the format "YYYY-MM-DD" or an empty string.
 */
export const DateTimeRegExp =
  /(^\d{4}-(0?[1-9]|1[012])-(0?[1-9]|[12][0-9]|3[01])$|^$)/i;

/**
 * Extracts a value from a JSON string based on a given key.
 *
 * @param data - The JSON string from which to extract the value.
 * @param key - The key to search for in the JSON string.
 * @returns The extracted value, or `undefined` if the key is not found.
 */
export const extractValueFromJson = (data: string, key: string) => {
  const rx = new RegExp(`${key}"s?:s?"(.+)"`);
  const values = rx.exec(data);
  return values?.[1];
};
