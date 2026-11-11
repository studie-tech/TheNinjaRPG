import { z } from "zod";
import {
  DEFAULT_PARTY_PLAYERS,
  MAX_PARTY_PLAYERS,
  MIN_PARTY_PLAYERS,
} from "@/drizzle/constants";

/** Staff configure the maximum number of human players in a co-op group. */
export const partyCapacitySchema = z
  .number()
  .int()
  .min(MIN_PARTY_PLAYERS)
  .max(MAX_PARTY_PLAYERS)
  .prefault(DEFAULT_PARTY_PLAYERS);
