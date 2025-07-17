/**
 * Group objects by key
 */
export const groupBy = <T, K extends keyof T>(value: T[], key: K) =>
  value.reduce((acc, curr) => {
    if (acc.get(curr[key])) return acc;
    acc.set(
      curr[key],
      value.filter((elem) => elem[key] === curr[key]),
    );
    return acc;
  }, new Map<T[K], T[]>());

/**
 * Return unique objects in array
 */
export const getUnique = <T, K extends keyof T>(array: T[], key: K) => {
  return [
    ...new Map(
      array.filter(Boolean).map((element) => [element[key], element]),
    ).values(),
  ];
};

/**
 * Reduces an array of objects into a record, grouping by a key and summing the `count` property.
 *
 * @param array - The array of objects to reduce.
 * @param key - The key of the object to group by.
 * @returns A record where each key is a group and the value is the sum of the `count` property.
 *
 * Example:
 *   reduceByKey(
 *     [{category: 'A', count: 2}, {category: 'A', count: 3}, {category: 'B', count: 1}],
 *     'category'
 *   )
 *   // => { A: 5, B: 1 }
 */
export function reduceByKey<
  T extends Record<K, string | number | symbol | null | undefined> & { count: number },
  K extends keyof T,
>(array: T[], key: K): Record<string, number> {
  return array.reduce<Record<string, number>>((acc, cur) => {
    const groupKey = cur[key];
    // Convert null/undefined to string for consistent object keys
    const safeKey = groupKey == null ? String("N/A") : String(groupKey);
    acc[safeKey] =
      (acc[safeKey] ?? 0) + (typeof cur.count === "number" ? cur.count : 0);
    return acc;
  }, {});
}
