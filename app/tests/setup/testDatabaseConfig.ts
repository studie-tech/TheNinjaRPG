/**
 * Require explicit consent for the database that SQL fixtures truncate. Never fall back to
 * DATABASE_URL: developer or preview credentials must not become test databases. A configured
 * URL without consent is an error rather than a reason to silently skip SQL suites.
 */
export const readTestDatabaseUrl = (
  environment: Record<string, string | undefined>,
) => {
  const url = environment.TEST_MYSQL_URL;
  if (url && environment.TEST_MYSQL_ALLOW_DESTRUCTIVE !== "1") {
    throw new Error(
      "TEST_MYSQL_URL is set but TEST_MYSQL_ALLOW_DESTRUCTIVE is not '1'. Every table in that " +
        "database will be truncated, so opt in explicitly and only for a database you can lose.",
    );
  }
  return url || undefined;
};
