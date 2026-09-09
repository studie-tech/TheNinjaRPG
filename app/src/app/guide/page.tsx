import { GuideHub } from "@/layout/GuideHub";
import { fetchPublishedGuides } from "@/server/api/routers/guide";
import { drizzleDB } from "@/server/db";

export default async function GuideHome() {
  const articles = await fetchPublishedGuides(drizzleDB);
  return <GuideHub articles={articles} />;
}
