"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { type LemuVariant, normalizeLemuVariant } from "@/libs/lemuExperiment";
import { readDocumentCookie } from "@/utils/cookies";

export type AbVariant = LemuVariant;

type Options = {
  defaultVariant?: AbVariant;
  parse?: (raw: string) => AbVariant | undefined;
};

/**
 * normalizeVariant
 * - Normalizes a raw value to an A/B test variant
 * @param raw - The raw value to normalize
 * @param parser - The parser to use
 * @returns
 */
const normalizeVariant = (
  raw: string | undefined,
  parser?: Options["parse"],
): AbVariant | undefined => {
  if (!raw) return undefined;
  if (parser) return parser(raw);
  return normalizeLemuVariant(raw);
};

/**
 * useAbVariant
 * - Reads an A/B test variant from a cookie
 * @param cookieName - The name of the cookie to read
 * @param options
 * @returns
 */
export const useAbVariant = (cookieName: string, options?: Options) => {
  const [rawValue, setRawValue] = useState<string | undefined>(undefined);

  const refresh = useCallback(() => {
    setRawValue(readDocumentCookie(cookieName));
  }, [cookieName]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const variant: AbVariant | undefined = useMemo(() => {
    return normalizeVariant(rawValue, options?.parse) ?? options?.defaultVariant;
  }, [rawValue, options?.defaultVariant, options?.parse]);

  const isControl = variant === "control";
  const isTreatment = variant !== undefined && variant !== "control";

  return {
    variant,
    isControl,
    isTreatment,
    refresh,
  } as const;
};
