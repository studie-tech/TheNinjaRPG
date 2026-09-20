import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * next/link with prefetching off unless a link asks for it.
 *
 * Every route renders under the root layout, which reads the session and cookies, so
 * every route is dynamic. A prefetch of a dynamic route is a function invocation whose
 * payload the router throws away: dynamic segments have no client cache, and the click
 * still round-trips to the server. Only the route tree is kept, for five minutes. Each
 * link in the viewport costs two of those requests per full page load, which made the
 * four footer links the busiest routes on the site after the API. Pass `prefetch`
 * explicitly on a link that has been shown to benefit, and flip the default here once
 * the shell is static and a prefetch fetches something a navigation can reuse.
 */
const Link = ({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) => (
  <NextLink prefetch={prefetch} {...props} />
);

export default Link;
