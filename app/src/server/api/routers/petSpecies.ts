import { nanoid } from "nanoid";
import type { Jutsu } from "@/drizzle/schema";
import { isPetJutsuAllowedForSpecies } from "@/libs/pets/abilities";
import { callDiscordContent } from "@/libs/socials";
import { listJutsuByIds } from "@/queries/jutsu";
import {
  findPetSpeciesByName,
  findPetSpeciesForGet,
  insertActionLogForCreate,
  insertActionLogForUpdate,
  insertPetSpeciesForCreate,
  listPetSpeciesForGetAll,
  updatePetSpeciesForUpdate,
} from "@/queries/petSpecies";
import { fetchUser } from "@/queries/profile";
import {
  baseServerResponse,
  createTRPCRouter,
  errorResponse,
  protectedProcedure,
  publicProcedure,
  serverError,
} from "@/server/api/trpc";
import { isMysqlDuplicateKeyError } from "@/server/utils/mysqlErrors";
import { calculateContentDiff } from "@/utils/diff";
import { canChangeContent } from "@/utils/permissions";
import { idSchema } from "@/validators/misc";
import { PetSpeciesValidator } from "@/validators/petSpecies";

/** IDs remain immutable when staff edit species content or retire an offering. */
const updatePetSpeciesSchema = idSchema.extend({ data: PetSpeciesValidator });

/** Manage authored species independently of each companion's generated artwork and progress. */
export const petSpeciesRouter = createTRPCRouter({
  /** Include retired species so the manual and owned companions retain their identities. */
  getAll: publicProcedure.query(({ ctx }) => listPetSpeciesForGetAll(ctx.drizzle)),

  /** Resolve the same authored identity for both editing and previously adopted pets. */
  get: publicProcedure.input(idSchema).query(async ({ ctx, input }) => {
    const species = await findPetSpeciesForGet(ctx.drizzle, input);
    if (!species) throw serverError("NOT_FOUND", "Companion species not found");
    return species;
  }),

  /** Save a new immutable species ID using the shared Content permission and audit conventions. */
  create: protectedProcedure
    .input(PetSpeciesValidator)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, existing, defaults] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findPetSpeciesByName(ctx.drizzle, input.name),
        input.defaultJutsuIds.length
          ? listJutsuByIds(ctx.drizzle, input.defaultJutsuIds)
          : [],
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role))
        return errorResponse("Not allowed to create companion species");
      if (existing) return errorResponse("Companion species name already exists");
      // The new species ID does not exist yet, so defaults must allow any species.
      if (!isValidDefaultLoadout(defaults, input.defaultJutsuIds))
        return errorResponse(INVALID_DEFAULT_LOADOUT);
      const id = nanoid();
      try {
        await insertPetSpeciesForCreate(ctx.drizzle, id, input);
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("Companion species name already exists");
        throw error;
      }
      const changes = calculateContentDiff({}, input);
      await insertActionLogForCreate(ctx.drizzle, ctx, changes, id, input);
      await callDiscordContent(user.username, input.name, changes);
      return { success: true, message: id };
    }),

  /** Retirement removes future offerings; existing pets, portraits and progression stay intact. */
  update: protectedProcedure
    .input(updatePetSpeciesSchema)
    .output(baseServerResponse)
    .mutation(async ({ ctx, input }) => {
      const [user, species, existing, defaults] = await Promise.all([
        fetchUser(ctx.drizzle, ctx.userId),
        findPetSpeciesForGet(ctx.drizzle, input),
        findPetSpeciesByName(ctx.drizzle, input.data.name),
        input.data.defaultJutsuIds.length
          ? listJutsuByIds(ctx.drizzle, input.data.defaultJutsuIds)
          : [],
      ]);
      if (user.isBanned)
        return errorResponse("You are banned and cannot perform this action");
      if (!canChangeContent(user.role))
        return errorResponse("Not allowed to edit companion species");
      if (!species) return errorResponse("Companion species not found");
      if (existing && existing.id !== species.id)
        return errorResponse("Companion species name already exists");
      if (!isValidDefaultLoadout(defaults, input.data.defaultJutsuIds, input.id))
        return errorResponse(INVALID_DEFAULT_LOADOUT);
      const changes = calculateContentDiff(species, { ...species, ...input.data });
      if (changes.length === 0)
        return { success: true, message: "Companion species is already up to date." };
      try {
        const updated = await updatePetSpeciesForUpdate(ctx.drizzle, input, species);
        if (updated.rowsAffected !== 1)
          return errorResponse("Companion species not found");
      } catch (error) {
        if (isMysqlDuplicateKeyError(error))
          return errorResponse("Companion species name already exists");
        throw error;
      }
      await insertActionLogForUpdate(ctx.drizzle, ctx, changes, species);
      await callDiscordContent(user.username, input.data.name, changes);
      return { success: true, message: "Companion species updated." };
    }),
});

const INVALID_DEFAULT_LOADOUT =
  "Choose published, compatible PETS jutsu for the default loadout.";

/** Every requested default exists and suits the species. */
const isValidDefaultLoadout = (
  defaults: Jutsu[],
  requestedIds: string[],
  speciesId?: string,
) =>
  defaults.length === requestedIds.length &&
  defaults.every((entry) => isPetJutsuAllowedForSpecies(entry, speciesId));
