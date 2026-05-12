import { z } from "zod";
import { CoreVillages, LegacyVillageNames } from "@/drizzle/constants";

/**
 * Names that are reserved against being used as clan, faction, or ANBU squad names.
 * The list mixes single-word entries (which match against the alphanumeric input
 * directly) and multi-word entries like "Freedom State" — the latter are
 * normalized so variants such as "FreedomState" or "freedom_state" are also
 * blocked.
 */
export const RESERVED_FACTION_NAMES = [
  "Freedom State",
  "Horizon",
  ...CoreVillages,
  ...LegacyVillageNames,
] as const;

const normalizeReservedName = (name: string) =>
  name.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const isReserved = (name: string, reserved: readonly string[]) => {
  const normalized = normalizeReservedName(name);
  if (!normalized) return false;
  return reserved.some((r) => normalizeReservedName(r) === normalized);
};

interface ReservedNameFieldOptions {
  reserved: readonly string[];
  minLength?: number;
  maxLength?: number;
  /** Customizes the "not allowed" refine error message. */
  errorMessage?: string;
}

/**
 * Builds a trimmed alphanumeric/underscore string field that also rejects any
 * name colliding with the reserved list (case- and separator-insensitive).
 */
export const createReservedNameField = ({
  reserved,
  minLength = 3,
  maxLength = 88,
  errorMessage = "This name is not allowed.",
}: ReservedNameFieldOptions) =>
  z
    .string()
    .trim()
    .min(minLength)
    .max(maxLength)
    .regex(/^[a-zA-Z0-9_]+$/, {
      error: "Alphanumeric and underscores only",
    })
    .refine((name) => !isReserved(name, reserved), { error: errorMessage });

/**
 * Loose validator for clan/squad name fields on edit endpoints. Older records
 * may contain spaces or other characters that the create-time validator now
 * rejects; this lets the owner still edit non-name fields (e.g. image) without
 * being blocked. Strict validation is re-applied server-side when the name
 * actually changes.
 */
export const looseFactionNameField = z.string().trim().min(3).max(88);
