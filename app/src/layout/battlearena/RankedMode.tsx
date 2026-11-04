"use client";

import { RankedArenaMain, RankedLoadoutSelector } from "@/layout/PvpRank";

/** Ranked PvP: the season, the queue and the ranked loadout. */
export const RankedMode = () => (
  <>
    <RankedArenaMain />
    <RankedLoadoutSelector />
  </>
);
