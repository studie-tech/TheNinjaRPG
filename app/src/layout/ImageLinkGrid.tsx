import type React from "react";
import Image from "@/layout/Image";
import Link from "@/layout/Link";

/** Hub grid of captioned image tiles, in the order given. */
export const ImageLinkGrid: React.FC<ImageLinkGridProps> = ({ entries, priority }) => (
  <div className="grid grid-cols-3 gap-4 text-center font-bold sm:grid-cols-4">
    {entries.map((page) => (
      <Link
        key={page.name}
        href={page.href}
        className="flex min-w-0 flex-col items-center"
      >
        <Image
          className="h-auto max-w-full rounded-2xl border-2 border-black hover:cursor-pointer hover:opacity-50"
          src={page.img}
          alt={page.label ?? page.name}
          width={125}
          height={125}
          priority={priority}
        />
        <p className="wrap-break-word w-full">{page.label ?? page.name}</p>
      </Link>
    ))}
  </div>
);

interface ImageLinkGridProps {
  /** `label` is the caption; entries without one are captioned with `name`. */
  entries: { name: string; label?: string; href: string; img: string }[];
  /** Load the tiles eagerly, for grids at the top of the page. */
  priority?: boolean;
}
