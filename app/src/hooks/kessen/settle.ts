/**
 * Runs a request and reports a rejection as a value, which keeps `try` out of the
 * Kessen hooks (the React Compiler cannot lower value blocks inside one).
 */
export const settle = async <T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> => {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
};

/**
 * A request rejection as the line shown next to the action: a client error (4xx) keeps
 * its own reason, while transport and server failures read as `fallback`, by default an
 * unreachable table.
 */
export const errorText = (
  error: unknown,
  fallback = "The table could not reach the server. Try again.",
) => {
  const httpStatus = (error as { data?: { httpStatus?: unknown } } | null)?.data
    ?.httpStatus;
  return error instanceof Error &&
    error.message &&
    typeof httpStatus === "number" &&
    httpStatus < 500
    ? error.message
    : fallback;
};
