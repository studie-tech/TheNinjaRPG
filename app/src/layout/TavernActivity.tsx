"use client";

import { useTavernActivity } from "@/hooks/useTavernActivity";
import { selectUserWithoutPosition, useUserDataSelector } from "@/utils/UserContext";

/** Counts new tavern messages for the chat button on every page. */
export function TavernActivity() {
  const { data: userData, pusher } = useUserDataSelector(selectUserWithoutPosition);
  useTavernActivity(pusher, userData);
  return null;
}
