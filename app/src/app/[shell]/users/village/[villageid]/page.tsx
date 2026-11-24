"use client";

import { use } from "react";
import { VillageUsersScreen } from "@/screens/users/village/VillageUsersScreen";

export default function VillageUsers(props: {
  params: Promise<{ villageid: string }>;
}) {
  return <VillageUsersScreen params={use(props.params)} />;
}
