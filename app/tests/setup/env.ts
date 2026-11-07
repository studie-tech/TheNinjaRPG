import { afterEach } from "bun:test";

/**
 * Capture the named `process.env` keys; the returned function puts them back. A key that was
 * unset is deleted, because Bun stores an assigned `undefined` as the string "undefined".
 */
export const snapshotEnv = (...keys: string[]) => {
  const saved = keys.map((key) => [key, process.env[key]] as const);
  return () => {
    const env = process.env as Record<string, string | undefined>;
    for (const [key, value] of saved) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  };
};

/** Undo every change a test makes to the named `process.env` keys. */
export const restoreEnvAfterEach = (...keys: string[]) => {
  afterEach(snapshotEnv(...keys));
};
