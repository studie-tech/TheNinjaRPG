"use client";

import ContentBox from "@/layout/ContentBox";
import ItemWithEffects, { type ItemWithEffectsProps } from "@/layout/ItemWithEffects";

interface ContentDetailProps {
  item: ItemWithEffectsProps["item"];
  title: string;
  subtitle: string;
  backHref: string;
  showEdit?: ItemWithEffectsProps["showEdit"];
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
}) => {
  return (
    <ContentBox title={title} subtitle={subtitle} defaultBackHref={backHref}>
      <ItemWithEffects item={item} showEdit={showEdit} />
    </ContentBox>
  );
};

export default ContentDetail;
