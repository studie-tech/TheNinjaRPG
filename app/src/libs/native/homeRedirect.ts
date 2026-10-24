import { atom } from "jotai";

/**
 * A destination NativeBridge has already issued while Home is loading the session.
 * Home must not replace or repeat that pending navigation.
 * Leaving home clears the intent so a later Home visit uses its normal destination.
 */
export const nativeHomeRedirectAtom = atom<string | null>(null);
