import NotFoundPage from "@/components/layout/NotFoundPage";

/**
 * Rendered whenever a route calls notFound().
 *
 * global-not-found.tsx only covers URLs that match no route at all. Without this file
 * Next falls back to its built-in page, which injects `body{background:#fff}` and a
 * full-height centred block inside the still-rendered game chrome, so routes that call
 * notFound() (e.g. profile pages) would look broken rather than merely empty.
 */
export default function NotFound() {
  return <NotFoundPage />;
}
