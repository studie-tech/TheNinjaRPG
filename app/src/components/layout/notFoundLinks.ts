/** A way back into the game offered by a 404 page. */
export interface NotFoundLink {
  href: string;
  label: string;
}

/** The links every 404 offers back into the game, in the shell and outside it. */
export const NOT_FOUND_LINKS: readonly NotFoundLink[] = [
  { href: "/", label: "Return to the front page" },
  { href: "/guide", label: "Read the guides" },
  { href: "/manual", label: "Open the manual" },
];
