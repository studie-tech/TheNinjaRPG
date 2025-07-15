export type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;

export type JsonData =
  | string
  | number
  | boolean
  | { [x: string]: JsonData }
  | Array<JsonData>;

// Convert key null values to empty strings
export const setValueOnObj = <T, K extends keyof T>(obj: T, key: K, value: T[K]) => {
  obj[key] = value;
  return obj;
};

/**
 * Reset all fields on an object that are null to empty strings. Convenient
 * for forms, where null does not exist, but needs to be empty strings instead
 */
export const setNullsToEmptyStrings = (
  obj: Record<string, unknown> | undefined | null,
) => {
  if (obj) {
    let k: keyof typeof obj;
    for (k in obj) {
      if (obj[k] === null) setValueOnObj(obj, k, "");
    }
  }
};

/**
 * Reset all fields on an object that are null to empty strings. Convenient
 * for forms, where null does not exist, but needs to be empty strings instead
 */
export const setEmptyStringsToNulls = (
  obj: Record<string, unknown> | undefined | null,
) => {
  if (obj) {
    let k: keyof typeof obj;
    for (k in obj) {
      if (obj[k] === "") setValueOnObj(obj, k, null);
    }
  }
};

/** Get object keys with their types */
export const objectKeys = <T extends object>(obj: T) => {
  return Object.keys(obj) as Array<keyof T>;
};

/**
 * Deep partial type
 * @param T - The type to make partial
 * @returns The partial type
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
