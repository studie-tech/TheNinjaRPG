/**
 * Preload script for bun test that provides fallback environment variables.
 * This ensures tests don't fail when env vars required by src/env/client.mjs
 * are missing (e.g., in CI without configured secrets).
 *
 * Process-level env vars and .env files take precedence; these are only
 * applied when the variable is unset or empty.
 */

const defaults: Record<string, string> = {
  NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
  NEXT_PUBLIC_PUSHER_APP_KEY: "test-key",
  NEXT_PUBLIC_PUSHER_APP_CLUSTER: "us2",
  NODE_ENV: "test",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
