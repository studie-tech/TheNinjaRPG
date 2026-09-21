import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { userData } from "@/drizzle/schema";
import { drizzleDB } from "@/server/db";
import { canChangeContent } from "@/utils/permissions";
import { FishingHabitatEditor } from "./FishingHabitatEditor";

export const dynamic = "force-dynamic";

export default async function ManualFishingHabitats() {
  const clerkUser = await currentUser();
  if (!clerkUser) redirect("/fishing");
  const user = await drizzleDB.query.userData.findFirst({
    columns: { role: true },
    where: eq(userData.userId, clerkUser.id),
  });
  if (!user || !canChangeContent(user.role)) redirect("/fishing");
  return <FishingHabitatEditor />;
}
