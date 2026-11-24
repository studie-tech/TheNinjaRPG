"use client";

import { use } from "react";
import { PublicProfileScreen } from "@/screens/users/ipsearch/PublicProfileScreen";

export default function PublicProfile(props: { params: Promise<{ ip: string }> }) {
  return <PublicProfileScreen params={use(props.params)} />;
}
