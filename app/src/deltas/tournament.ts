import type { RouterOutputs } from "@/app/_trpc/client";
import { EVENT_TOURNAMENT_READY_SECONDS } from "@/drizzle/constants";

type EventNotices = RouterOutputs["tournament"]["getEventNotices"];

/** Keep invitation discovery within one minute and quickly reconcile prompts awaiting a response. */
export const getEventTournamentNoticePollInterval = (hasNotices: boolean) =>
  Math.min(hasNotices ? 15_000 : 60_000, (EVENT_TOURNAMENT_READY_SECONDS * 1000) / 2);

/** Hide expired tournament prompts even when their authoritative refresh fails or arrives late. */
export const getVisibleEventTournamentNotices = (
  notices: EventNotices | undefined,
  serverNow: number,
) => notices?.filter((notice) => notice.deadline > serverNow) ?? [];
