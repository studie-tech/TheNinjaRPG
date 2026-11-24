import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { findUserRoleById } from "@/queries/profile";
import { ManualWorldEditor } from "@/screens/manual/world/ManualWorldEditor";
import { drizzleDB } from "@/server/db";
import { canChangeContent } from "@/utils/permissions";

/**
 * Staff map-editing hub. Player travel docs live at /guide/world.
 * The redirect is server-side so crawlers and no-JS clients do not stay on a 200 loader.
 */
export async function ManualWorldScreen() {
  const { userId } = await auth();
  if (!userId) redirect("/guide/world");
  const row = await findUserRoleById(drizzleDB, userId);
  if (!row || !canChangeContent(row.role)) {
    redirect("/guide/world");
  }
  return <ManualWorldEditor />;
}
