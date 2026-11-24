/** Prepare the bundled LPC designs before a managed local Next server starts. */
import { lpcSeedAssets } from "../drizzle/data/lpc/seed";
import type { DrizzleClient } from "../src/server/db";
import { lpcConfigValidator } from "../src/validators/lpcAsset";

/** Exact loopback and Compose proxy names; a remote database is never backfilled automatically. */
export const isLocalLpcDatabase = (value: string | undefined) => {
  try {
    const url = new URL(value ?? "");
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]", "planetscale", "tnr_planetscale"].includes(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
};

/** Read catalog readiness, optionally backfilling missing designs in local development. */
export const prepareDevLpc = async ({
  databaseUrl,
  readOnly = false,
  client,
}: {
  databaseUrl: string | undefined;
  readOnly?: boolean;
  client?: DrizzleClient;
}): Promise<DevLpcReport> => {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL ||
    process.env.VERCEL_ENV
  )
    return { status: "skipped", message: "LPC setup runs only in local development." };
  try {
    new URL(databaseUrl ?? "");
  } catch {
    return {
      status: "unavailable",
      message: "Configure a valid DATABASE_URL in app/.env.",
    };
  }
  if (!isLocalLpcDatabase(databaseUrl))
    return {
      status: "skipped",
      message: "DATABASE_URL is not a local development proxy.",
    };

  try {
    // Loading the application client only after the guard also keeps remote doctor runs offline.
    const database = client ?? (await import("../src/server/db")).drizzleDB;
    const { listLpcAssets } = await import("../src/queries/asset");
    if (!readOnly) {
      const { seedLpcAssets } = await import("../drizzle/seeds/lpc");
      await seedLpcAssets(database);
    }
    const assets = await listLpcAssets(database);
    const required = lpcSeedAssets().map((asset) => asset.id);
    const saved = new Map(assets.map((asset) => [asset.id, asset]));
    const missing = required.filter((id) => !saved.has(id));
    const invalid = required.filter(
      (id) =>
        saved.has(id) &&
        !lpcConfigValidator.safeParse(saved.get(id)?.lpcConfig).success,
    );
    const ready = missing.length === 0 && invalid.length === 0;
    return {
      status: ready ? "ready" : "incomplete",
      designs: required.length - missing.length,
      expectedDesigns: required.length,
      missing,
      invalid,
      message: ready
        ? "Bundled LPC designs and travel atlases are configured."
        : readOnly && missing.length > 0
          ? "Run make dev-prepare to add missing LPC designs. Restart an already running server with make dev-down then make dev-up to refresh its scene catalog. Existing designs are preserved."
          : "Repair the listed LPC designs in the asset editor; existing artwork is preserved.",
    };
  } catch (error) {
    // Driver errors can include SQL, full artwork JSON or connection details.
    return {
      status: "unavailable",
      message:
        error instanceof Error &&
        /^GameAsset ID [a-zA-Z0-9-]+ belongs to another media type; LPC sync stopped\.$/.test(
          error.message,
        )
          ? error.message
          : "Could not prepare LPC designs. Check the local database connection and apply the current schema migrations, including GameAsset.lpcConfig and the LPC asset type, then run make dev-prepare.",
    };
  }
};

type DevLpcReport = {
  status: "ready" | "incomplete" | "unavailable" | "skipped";
  message: string;
  designs?: number;
  expectedDesigns?: number;
  missing?: string[];
  invalid?: string[];
};

if (import.meta.main) {
  const report = await prepareDevLpc({ databaseUrl: process.env.DATABASE_URL });
  console.log(`dev-lpc: ${JSON.stringify(report)}`);
  if (report.status !== "ready" && report.status !== "skipped") process.exitCode = 1;
}
