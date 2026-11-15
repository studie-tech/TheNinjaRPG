/**
 * Return false for an exhausted `label` allowance. Unlike the shared tRPC limiter, an SDK
 * timeout is refused too; backend errors fail closed outside development.
 */
export const strictRateLimit = async (
  label: string,
  limit: () => Promise<{ success: boolean; reason?: string }>,
): Promise<boolean> => {
  try {
    const result = await limit();
    // The SDK resolves its timeout as success, so explicitly keep production closed.
    if (result.reason === "timeout")
      throw new Error(`Unable to verify ${label} allowance. Please try again.`);
    return result.success;
  } catch (error) {
    // Match the tRPC policy for an unavailable local Redis shim.
    if (process.env.NODE_ENV !== "development") throw error;
    console.warn(`${label} limiter unavailable in development`, error);
    return true;
  }
};
