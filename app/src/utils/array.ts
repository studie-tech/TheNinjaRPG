/**
 * Returns a random element from the given array.
 *
 * @template T - The type of elements in the array.
 * @param arr - The array from which to select a random element.
 * @returns - A random element from the array, or undefined if the array is empty.
 */
export const getRandomElement = <T>(arr?: T[] | readonly T[]) => {
  const length = arr?.length;
  if (length) {
    const idx = Math.floor(Math.random() * length);
    return arr?.[idx];
  } else {
    return undefined;
  }
};

/**
 * Fisher-Yates shuffle into a new array.
 * @param randomIndex - Source of an integer in [0, n); defaults to Math.random
 */
export const shuffle = <T>(
  items: readonly T[],
  randomIndex: (n: number) => number = (n) => Math.floor(Math.random() * n),
): T[] => {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
};

/**
 * New list with the entry at `index` moved one step in `direction`, or the same list when
 * there is no such entry or it is already at that end.
 */
export const moveItem = <T>(list: T[], index: number, direction: -1 | 1): T[] => {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
};

/**
 * Splits an array into bounded batches without mutating the input.
 */
export const chunkArray = <T>(values: readonly T[], batchSize: number): T[][] => {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new RangeError("batchSize must be a positive integer");
  }

  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize));
  }
  return batches;
};

/**
 * Checks if the given item is in the given array.
 * @param item
 * @param array
 */
export const isInArray = <T, A extends T>(
  item: T,
  array: ReadonlyArray<A>,
): item is A => {
  return array.includes(item as A);
};

/**
 * Collapses repeated names into one entry with a count, keeping first-seen order,
 * e.g. ["Sickle", "Sickle", "Bow"] -> ["Sickle ×2", "Bow"].
 */
export const countNames = (names: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
};
