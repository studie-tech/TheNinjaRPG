import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * next/link with prefetching off unless a link asks for it.
 *
 * Every page is a prerendered shell whose content arrives through tRPC after it mounts,
 * so a prefetched document buys a navigation almost nothing: the data it waits on is
 * not in it. What a prefetch does cost is a transfer per link in the viewport per page
 * load, and the game frame keeps twenty or more links in view. Before the shell was
 * static each of those was also a function invocation, which made the four footer links
 * the busiest routes on the site after the API. Pass `prefetch` explicitly on a link
 * that has been shown to benefit.
 */
const Link = ({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) => (
  <NextLink prefetch={prefetch} {...props} />
);

export default Link;
