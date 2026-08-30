"use client";

import { useEffect, useState } from "react";
import { isNative } from "@/libs/native";

/**
 * Hydration-safe `isNative()`.
 *
 * The Capacitor bridge only exists in the browser, so calling `isNative()` during render
 * returns false on the server and true in the shell — a mismatch React reports as a
 * hydration error. This settles after mount instead, which means one render as "web"
 * before the shell-specific UI appears.
 */
export const useNativeShell = (): boolean => {
  const [isShell, setIsShell] = useState(false);
  useEffect(() => setIsShell(isNative()), []);
  return isShell;
};
