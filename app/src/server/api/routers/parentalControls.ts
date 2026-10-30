import { getServerPusher } from "@/libs/pusher";
import {
  findParentalControlForGet,
  findParentalControlForSave,
  insertParentalControlForSave,
  listUserDataForGet,
  listUserDataForSave,
  updateParentalControlForSave,
  updateParentalControlForSave2,
} from "@/queries/parentalControls";
import {
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  serverError,
} from "@/server/api/trpc";
import { retryOnDeadlock } from "@/server/utils/mysqlErrors";
import { hashParentalPin, verifyParentalPin } from "@/server/utils/parentalControls";
import { parentalSettingsSchema } from "@/validators/parentalControls";

/** Account-level parental settings; versioned writes require the stored parent PIN when present. */
export const parentalControlsRouter = createTRPCRouter({
  /** Returns the editable policy and PIN presence without exposing the stored hash. */
  get: protectedProcedure.query(async ({ ctx }) => {
    const settings = await findParentalControlForGet(ctx.drizzle, ctx);
    const approvedPlayers = settings?.approvedUserIds.length
      ? await listUserDataForGet(ctx.drizzle, settings)
      : [];
    return {
      enabled: settings?.enabled ?? false,
      tavernDisabled: settings?.tavernDisabled ?? false,
      privateMessages: settings?.privateMessages ?? ("EVERYONE" as const),
      approvedUserIds: settings?.approvedUserIds ?? [],
      hasPin: !!settings?.pinHash,
      version: settings?.version ?? 0,
      approvedPlayers,
    };
  }),
  /** Requires the stored parent PIN when present; enabling without one creates a new PIN. */
  save: protectedProcedure
    .input(parentalSettingsSchema)
    .mutation(async ({ ctx, input }) => {
      const [settings, players] = await Promise.all([
        findParentalControlForSave(ctx.drizzle, ctx),
        input.approvedUserIds.length ? listUserDataForSave(ctx.drizzle, input) : [],
      ]);
      if (
        players.length !== new Set(input.approvedUserIds).size ||
        input.approvedUserIds.includes(ctx.userId)
      ) {
        return errorResponse("Choose existing players other than yourself.");
      }
      if ((settings?.version ?? 0) !== input.version) {
        return errorResponse(
          "Settings changed in another tab. Reload them before saving.",
        );
      }
      if (settings?.pinHash) {
        // Claim an attempt before hashing, so concurrent requests cannot bypass the five-attempt window.
        const cutoff = new Date(Date.now() - 15 * 60 * 1000);
        const claim = await updateParentalControlForSave(
          ctx.drizzle,
          cutoff,
          ctx,
          input,
        );
        if (!claim.rowsAffected)
          return errorResponse(
            "Too many PIN attempts or settings changed. Try again in 15 minutes or reload settings.",
          );
        if (!(await verifyParentalPin(input.pin, settings.pinHash)))
          return errorResponse("Incorrect parent PIN. Settings were not changed.");
      }
      const values = {
        enabled: input.enabled,
        tavernDisabled: input.enabled && input.tavernDisabled,
        privateMessages: input.enabled ? input.privateMessages : ("EVERYONE" as const),
        approvedUserIds: input.enabled ? [...new Set(input.approvedUserIds)] : [],
        pinHash: input.enabled
          ? await hashParentalPin(input.newPin ?? input.pin)
          : null,
        failedAttempts: 0,
        attemptWindowStart: new Date(),
        version: input.version + 1,
      };
      let result: { rowsAffected: number };
      try {
        // The version guard and unique account key allow only one concurrent save or setup to win.
        // A deadlock rolls back this statement; retry its unique/version guard without
        // repeating PIN verification or consuming another failed-attempt allowance.
        result = await retryOnDeadlock(async () =>
          settings
            ? updateParentalControlForSave2(ctx.drizzle, values, ctx, input)
            : insertParentalControlForSave(ctx.drizzle, ctx, values),
        );
      } catch {
        // Drizzle errors include SQL parameters, including the PIN hash. Do not expose
        // this derived credential to response serialization or error telemetry.
        throw serverError(
          "INTERNAL_SERVER_ERROR",
          "Could not save parental controls. Please try again.",
        );
      }
      if (!result.rowsAffected)
        return errorResponse(
          "Settings changed in another tab. Reload them before saving.",
        );
      // A notification failure must not turn a committed save into a reported failure.
      // Chat queries also refresh permissions on remount, focus and reconnect.
      void Promise.resolve()
        .then(() =>
          getServerPusher().trigger(ctx.userId, "event", {
            type: "parentalControlsChanged",
          }),
        )
        .catch(() => undefined);
      return {
        success: true,
        message: input.enabled
          ? "Parental controls saved"
          : "Parental controls disabled",
      };
    }),
});
