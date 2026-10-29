import type { ReactNode } from "react";
import Image from "@/layout/Image";

/** Card grid that adds columns as the farm gets wider. */
export const FARM_CARD_GRID =
  "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))]";

type FarmItemCardProps = {
  image?: string | null;
  title: ReactNode;
  /** Short lines under the title: yields, effects, requirements. */
  details?: ReactNode;
  /** Top-right tag, such as the unit price or the owned count. */
  aside?: ReactNode;
  /** Bottom action bar: a quantity control and the main button. */
  actions: ReactNode;
};

/**
 * Farm market, crop and extraction item: information above, one full-width action
 * bar below, so every card in a grid lines up the same way.
 */
export function FarmItemCard({
  image,
  title,
  details,
  aside,
  actions,
}: FarmItemCardProps) {
  return (
    <li className="flex flex-col overflow-hidden rounded-md border bg-card">
      <div className="flex flex-1 items-start gap-3 p-2.5">
        {image && <Image src={image} alt="" width={44} height={44} />}
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-semibold text-sm leading-tight">{title}</p>
          {details && <div className="text-muted-foreground text-xs">{details}</div>}
        </div>
        {aside}
      </div>
      <div className="flex items-center gap-2 border-t bg-muted/40 px-2.5 py-2">
        {actions}
      </div>
    </li>
  );
}
