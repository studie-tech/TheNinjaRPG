import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * next/link with prefetching off unless a link asks for it. A prefetched document buys a
 * navigation almost nothing -- the data it waits on arrives through tRPC after mount --
 * and the game frame keeps twenty or more links in view, each a transfer per page load.
 * Pass `prefetch` explicitly on a link shown to benefit.
 */
const Link = ({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) => (
  <NextLink prefetch={prefetch} {...props} />
);

export default Link;
