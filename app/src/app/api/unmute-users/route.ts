import { drizzleDB } from "@/server/db";
import { userData } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

export async function GET() {
  // disable cache for this server action
  await cookies();

  try {
    // Update all muted users to unmuted
    await drizzleDB
      .update(userData)
      .set({ isMuted: false })
      .where(eq(userData.isMuted, true));

    return Response.json("OK - All users unmuted");
  } catch (error) {
    console.error("Error unmuting users:", error);
    return Response.json("Error unmuting users", { status: 500 });
  }
}
