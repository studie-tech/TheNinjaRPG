import { GuideHubSkeleton } from "@/layout/GuideHub";

/**
 * Scoped to the hub by its route group: a boundary at guide/ would also wrap the article
 * routes, whose missing articles could then no longer answer with a 404 status.
 */
export default function GuideHubLoading() {
  return <GuideHubSkeleton />;
}
