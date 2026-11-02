"use client";

import { useEffect, useRef } from "react";
import type { UserWithRelations } from "@/routers/profile";
import { useUserDataRef } from "@/utils/UserContext";

/** Confirmed coordinates update one text node without reconciling the travel controls. */
export const TravelPositionLabel = () => {
  const label = useRef<HTMLSpanElement>(null);
  const user = useUserDataRef((next) => {
    if (label.current) label.current.textContent = positionText(next);
  });
  useEffect(() => {
    if (label.current) label.current.textContent = positionText(user.current);
  }, [user]);
  return <span ref={label}>{positionText(user.current)}</span>;
};

const positionText = (user: UserWithRelations) =>
  user ? `You (${user.longitude}, ${user.latitude})` : "You";
