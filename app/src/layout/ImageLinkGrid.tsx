import type React from "react";
import Image from "@/layout/Image";
import Link from "@/layout/Link";

/** Hub grid of captioned image tiles, in the order given. */
export const ImageLinkGrid: React.FC<ImageLinkGridProps> = ({
  entries,
  priority,
  children,
}) => (
  <div className="grid grid-cols-4 gap-4 text-center font-bold">
    {entries.map((page) => (
      <Link key={page.name} href={page.href} className="flex flex-col items-center">
        <Image
          className="rounded-2xl border-2 border-black hover:cursor-pointer hover:opacity-50"
          src={page.img}
          alt={page.name}
          width={125}
          height={125}
          priority={priority}
        />
        <p>{page.name}</p>
      </Link>
    ))}
    {children}
  </div>
);

interface ImageLinkGridProps {
  entries: { name: string; href: string; img: string }[];
  /** Load the tiles eagerly, for grids at the top of the page. */
  priority?: boolean;
  /** Extra tiles that are not image links, rendered after the entries. */
  children?: React.ReactNode;
}
