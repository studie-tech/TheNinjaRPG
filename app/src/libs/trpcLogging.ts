import { isPlainObject } from "@/utils/typeutils";

/** Suppress entire operations because both inputs and responses can contain credentials. */
export const hasSensitiveTrpcInput = (path: string | undefined) =>
  Boolean(
    path?.startsWith("meta.") ||
      path === "register.createCharacter" ||
      path?.startsWith("merch.") ||
      path?.startsWith("parentalControls.") ||
      path?.startsWith("nativeAuth."),
  );

/**
 * Operations whose input is too large for error telemetry: a tower defense claim carries
 * an action log of up to megabytes, past the size of an event Sentry accepts.
 */
export const hasOversizedTrpcInput = (path: string | undefined) =>
  path === "towerDefense.claimRun";

/** Whether error telemetry may carry an operation's input. */
export const canAttachTrpcInput = (path: string | undefined) =>
  !hasSensitiveTrpcInput(path) && !hasOversizedTrpcInput(path);

/** Redacts the whole sensitive input so future credential fields are also protected. */
export const diagnosticTrpcInput = (path: string | undefined, input: unknown) =>
  hasSensitiveTrpcInput(path)
    ? "[REDACTED]"
    : hasOversizedTrpcInput(path)
      ? "[OMITTED]"
      : input;

export const shouldLogTrpcOperation = (
  operation: { path?: string; direction: "up" | "down"; result?: unknown },
  development = process.env.NODE_ENV === "development",
) => {
  // The logger prints inputs, and console output becomes Sentry breadcrumbs.
  if (!canAttachTrpcInput(operation.path)) return false;
  // Walking is a continuous input stream. Keep rejected responses and transport failures visible.
  if (operation.path === "travel.moveInSector") {
    if (operation.direction === "up") return false;
    const response = operation.result;
    if (
      isPlainObject(response) &&
      isPlainObject(response.result) &&
      isPlainObject(response.result.data) &&
      response.result.data.success === true
    )
      return false;
  }
  return (
    development || (operation.direction === "down" && operation.result instanceof Error)
  );
};
