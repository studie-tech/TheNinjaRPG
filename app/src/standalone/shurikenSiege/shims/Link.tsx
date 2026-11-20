import type { AnchorHTMLAttributes, ReactNode } from "react";
import { readBuild } from "@/standalone/shurikenSiege/build";

const SITE_URL = "https://www.theninja-rpg.com";

/**
 * Stands in for the app's Link: a game page has no routes of its own, so links open
 * TheNinja-RPG in a new tab where the build may link, and are plain text where it may not.
 */
export default function Link(
  props: {
    href: string;
    children?: ReactNode;
  } & AnchorHTMLAttributes<HTMLAnchorElement>,
) {
  const { href, children, ...rest } = props;
  if (!readBuild().links) return <span className={rest.className}>{children}</span>;
  return (
    <a
      {...rest}
      href={href.startsWith("/") ? `${SITE_URL}${href}` : href}
      target="_blank"
      rel="noopener"
    >
      {children}
    </a>
  );
}
