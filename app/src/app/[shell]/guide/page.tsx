import { GuideHub } from "@/layout/GuideHub";
import { fetchPublishedGuides } from "@/server/api/routers/guide";
import { drizzleDB } from "@/server/db";

// The guide index reads the database at render time. With the shell prerendered that
// would otherwise happen at build, where CI has no database; it stays a per-request
// render like the other server-fetched pages.
export const dynamic = "force-dynamic";

export default async function GuideHome() {
  const articles = await fetchPublishedGuides(drizzleDB);
  return <GuideHub articles={articles} />;
}
