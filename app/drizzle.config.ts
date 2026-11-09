import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Marker-free migration files can contain multiple statements; this URL is only for Drizzle tooling.
const mysqlUrl = process.env.MYSQL_URL ? new URL(process.env.MYSQL_URL) : undefined;
mysqlUrl?.searchParams.set("multipleStatements", "true");

export default defineConfig({
  out: "./drizzle/migrations",
  schema: "./drizzle/schema.ts",
  dialect: "mysql",
  ...(mysqlUrl ? { dbCredentials: { url: mysqlUrl.toString() } } : {}),
  // Keep SQL directly pasteable into database consoles, without statement-breakpoint markers.
  breakpoints: false,
  verbose: true,
});
