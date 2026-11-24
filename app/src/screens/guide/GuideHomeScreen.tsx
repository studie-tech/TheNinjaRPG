import { GuideHub } from "@/layout/GuideHub";
import { fetchPublishedGuides } from "@/queries/guide";
import { drizzleDB } from "@/server/db";

/** Render the guide screen independently of its route adapter. */
export async function GuideHomeScreen() {
  const articles = await fetchPublishedGuides(drizzleDB);
  return <GuideHub articles={articles} />;
}
