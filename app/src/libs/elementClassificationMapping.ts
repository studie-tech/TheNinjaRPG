import {
  elementClassificationCatalogSchema,
  elementClassificationMappingSchema,
} from "@/validators/elements";

/** Backups serialize explicit INSERT columns; older backups omit classification. */
export const hasElementClassificationBackup = (sqlText: string) => {
  const columns = /^INSERT INTO `(Jutsu|Item)`\s*\(([^)]+)\)\s*VALUES\s/i.exec(
    sqlText,
  )?.[2];
  return columns?.split(",").some((column) => column.trim() === "`elements`") ?? false;
};

/** Require an explicit Content decision for every catalog row, including empty arrays. */
export const validateElementClassificationMapping = (
  mapping: unknown,
  catalog: unknown,
) => {
  const parsed = elementClassificationMappingSchema.parse(mapping);
  const existing = elementClassificationCatalogSchema.parse(catalog);
  for (const kind of ["jutsus", "items"] as const) {
    const ids = new Set(existing[kind].map((row) => row.id));
    if (ids.size !== existing[kind].length)
      throw new Error(`Duplicate ${kind} catalog IDs`);
    const seen = new Set<string>();
    for (const row of parsed[kind]) {
      if (seen.has(row.id)) throw new Error(`Duplicate ${kind} mapping ID: ${row.id}`);
      if (!ids.has(row.id)) throw new Error(`Unknown ${kind} mapping ID: ${row.id}`);
      seen.add(row.id);
    }
    const missing = [...ids].filter((id) => !seen.has(id));
    if (missing.length)
      throw new Error(`Missing ${kind} mappings: ${missing.join(", ")}`);
  }
  return parsed;
};
