"use client";

import { useEffect, useRef } from "react";
import type { UserWithRelations } from "@/routers/profile";
import { useUserDataRef } from "@/utils/UserContext";

/** Confirmed coordinates update one text node without reconciling the travel controls. */
/** The player's live position: "You (x, y)", or just "x, y" with `coordinatesOnly`. */
export const TravelPositionLabel = ({
  coordinatesOnly = false,
}: {
  coordinatesOnly?: boolean;
}) => {
  const label = useRef<HTMLSpanElement>(null);
  const user = useUserDataRef((next) => {
    if (label.current) label.current.textContent = positionText(next, coordinatesOnly);
  });
  useEffect(() => {
    if (label.current)
      label.current.textContent = positionText(user.current, coordinatesOnly);
  }, [user, coordinatesOnly]);
  return <span ref={label}>{positionText(user.current, coordinatesOnly)}</span>;
};

const positionText = (user: UserWithRelations, coordinatesOnly: boolean) => {
  if (!user) return coordinatesOnly ? "" : "You";
  const coordinates = `${user.longitude}, ${user.latitude}`;
  return coordinatesOnly ? coordinates : `You (${coordinates})`;
};
