"use client";

import { useTavernActivity } from "@/hooks/useTavernActivity";
import { useUserData } from "@/utils/UserContext";

/** Counts new tavern messages for the chat button on every page. */
export function TavernActivity() {
  const { data: userData, pusher } = useUserData();
  useTavernActivity(pusher, userData);
  return null;
}
