import { BarChart3, InfoIcon, Pencil } from "lucide-react";
import type React from "react";
import Link from "@/layout/Link";

const ICON_CLASS = "h-4 w-4 text-muted-foreground hover:text-primary";

/** Table cell linking a content row to its statistics, editor and details dialog. */
export const ContentLinksCell: React.FC<ContentLinksCellProps> = (props) => {
  const { type, id, canEdit, hideStatistics, onInfo } = props;
  return (
    <div className="flex items-center gap-2">
      {!hideStatistics && (
        <Link href={`/manual/${type}/statistics/${id}`}>
          <BarChart3 className={ICON_CLASS} />
        </Link>
      )}
      {canEdit && (
        <Link href={`/manual/${type}/edit/${id}`}>
          <Pencil className={ICON_CLASS} />
        </Link>
      )}
      {onInfo && (
        <InfoIcon className={`${ICON_CLASS} cursor-pointer`} onClick={onInfo} />
      )}
    </div>
  );
};

interface ContentLinksCellProps {
  /** Route segment under `/manual`. */
  type: "jutsu" | "item" | "bloodline" | "ai" | "skillTree";
  id: string;
  canEdit: boolean;
  /** Skill trees have no statistics route. */
  hideStatistics?: boolean;
  onInfo?: () => void;
}
