"use client";

import { useEffect, useState } from "react";

import { type LemuVariant, normalizeLemuVariant } from "@/libs/lemuExperiment";
import { readDocumentCookie } from "@/utils/cookies";

/**
 * Reads the Lemu experiment arm from a cookie after mounting, so the server render and the
 * first client render agree; unknown or missing assignments stay undefined.
 */
export const useAbVariant = (cookieName: string) => {
  const [variant, setVariant] = useState<LemuVariant>();

  useEffect(() => {
    setVariant(normalizeLemuVariant(readDocumentCookie(cookieName)));
  }, [cookieName]);

  return { variant } as const;
};
