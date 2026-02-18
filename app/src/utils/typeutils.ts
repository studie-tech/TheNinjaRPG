import type { ExecutedQuery } from "@planetscale/database";
import type { SQL } from "drizzle-orm";

export type ArrayElement<A> = A extends readonly (infer T)[] ? T : never;

export type JsonData =
  | string
  | number
  | boolean
  | { [x: string]: JsonData }
  | Array<JsonData>;

// Convert key null values to empty strings
export const setValueOnObj = <T, K extends keyof T>(object: T, key: K, value: T[K]) => {
  object[key] = value;
  return object;
};

/**
 * Reset all fields on an object that are null to empty strings. Convenient
 * for forms, where null does not exist, but needs to be empty strings instead
 */
export const setNullsToEmptyStrings = (
  object: Record<string, unknown> | undefined | null,
) => {
  if (object) {
    let propertyKey: keyof typeof object;
    for (propertyKey in object) {
      if (object[propertyKey] === null) setValueOnObj(object, propertyKey, "");
    }
  }
};

/**
 * Reset all fields on an object that are null to empty strings. Convenient
 * for forms, where null does not exist, but needs to be empty strings instead
 */
export const setEmptyStringsToNulls = (
  object: Record<string, unknown> | undefined | null,
) => {
  if (object) {
    let propertyKey: keyof typeof object;
    for (propertyKey in object) {
      if (object[propertyKey] === "") setValueOnObj(object, propertyKey, null);
    }
  }
};

/** Get object keys with their types */
export const objectKeys = <T extends object>(object: T) => {
  return Object.keys(object) as Array<keyof T>;
};

/**
 * Deep partial type
 * @param T - The type to make partial
 * @returns The partial type
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * A promise that returns a database query result or void
 */
export type DatabasePromiseReturn =
  | ExecutedQuery<unknown[] | Record<string, unknown>>
  | undefined;

/**
 * A condition for a database query
 */
export type QueryCondition = SQL<unknown> | undefined;

/**
 * Type guard to check if a value is a plain object (not null, not array).
 */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};
