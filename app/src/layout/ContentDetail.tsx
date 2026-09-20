"use client";

import { BookOpen } from "lucide-react";
import ContentBox from "@/layout/ContentBox";
import ItemWithEffects, { type ItemWithEffectsProps } from "@/layout/ItemWithEffects";
import Link from "@/layout/Link";

interface ContentDetailProps {
  item: ItemWithEffectsProps["item"];
  title: string;
  subtitle: string;
  backHref: string;
  showEdit?: ItemWithEffectsProps["showEdit"];
  /** A published player guide for this entry, when one exists. */
  guide?: { href: string; title: string };
}

/**
 * ContentDetail
 * - Client shell for the manual's per-entry pages. ItemWithEffects and ContentBox both
 *   rely on router hooks, so the detail routes fetch on the server and hand the data
 *   down through here rather than pulling it client-side after hydration.
 */
export const ContentDetail: React.FC<ContentDetailProps> = ({
  item,
  title,
  subtitle,
  backHref,
  showEdit,
  guide,
}) => {
  return (
    <ContentBox title={title} subtitle={subtitle} defaultBackHref={backHref}>
      <ItemWithEffects item={item} showEdit={showEdit} />
      {guide && (
        <p className="mt-4">
          <Link
            href={guide.href}
            className="inline-flex items-center gap-1 font-bold text-orange-500 hover:text-orange-700"
          >
            <BookOpen className="h-4 w-4" />
            Read the guide: {guide.title}
          </Link>
        </p>
      )}
    </ContentBox>
  );
};

export default ContentDetail;
