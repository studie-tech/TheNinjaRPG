"use client";

import { useEffect, useRef } from "react";
import type { UserWithRelations } from "@/routers/profile";
import { useUserDataRef } from "@/utils/UserContext";

/**
 * Confirmed coordinates update one subtitle text node without reconciling the travel controls.
 * A fixed minimum width keeps movement from shifting the header around them.
 */
export const TravelPositionLabel = () => {
  const label = useRef<HTMLSpanElement>(null);
  const user = useUserDataRef((next) => {
    if (label.current) label.current.textContent = positionText(next);
  });
  useEffect(() => {
    if (label.current) label.current.textContent = positionText(user.current);
  }, [user]);
  return (
    <span ref={label} className="inline-block min-w-[6ch] tabular-nums">
      {positionText(user.current)}
    </span>
  );
};

const positionText = (user: UserWithRelations) =>
  user ? `${user.longitude}, ${user.latitude}` : "";
