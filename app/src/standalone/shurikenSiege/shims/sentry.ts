/** Stands in for Sentry: a portal build reports nothing. */
export const captureException = () => undefined;
export const captureMessage = () => undefined;
export const addBreadcrumb = () => undefined;

/** Every metrics call is accepted and dropped. */
export const metrics = new Proxy({} as Record<string, () => undefined>, {
  get: () => () => undefined,
});
