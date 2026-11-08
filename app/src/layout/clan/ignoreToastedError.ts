/**
 * Ends a guarded submission whose failure the mutation's `onError` already toasted. Its
 * confirmation stays open with the same context, so the player can retry.
 */
export const ignoreToastedError = () => undefined;
