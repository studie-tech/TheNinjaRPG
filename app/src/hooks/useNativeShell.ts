"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/libs/native";

/**
 * Hydration-safe `isNative()`.
 *
 * The Capacitor bridge only exists in the browser, so calling `isNative()` during render
 * returns false on the server and true in the shell — a mismatch React reports as a
 * hydration error. `undefined` keeps sensitive web/native alternatives unmounted until the
 * bridge has been checked after hydration.
 */
export const useNativeShell = (): boolean | undefined => {
  const [isShell, setIsShell] = useState<boolean | undefined>(undefined);
  useEffect(() => setIsShell(isNative()), []);
  return isShell;
};
