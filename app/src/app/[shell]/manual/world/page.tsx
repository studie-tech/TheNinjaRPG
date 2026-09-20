import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { userData } from "@/drizzle/schema";
import { drizzleDB } from "@/server/db";
import { canChangeContent } from "@/utils/permissions";
import { ManualWorldEditor } from "./ManualWorldEditor";

export const dynamic = "force-dynamic";

/**
 * Staff map-editing hub. Player travel docs live at /guide/world.
 * The redirect is server-side so crawlers and no-JS clients do not stay on a 200 loader.
 */
export default async function ManualWorld() {
  const user = await currentUser();
  if (!user) redirect("/guide/world");
  const row = await drizzleDB.query.userData.findFirst({
    columns: { role: true },
    where: eq(userData.userId, user.id),
  });
  if (!row || !canChangeContent(row.role)) {
    redirect("/guide/world");
  }
  return <ManualWorldEditor />;
}
