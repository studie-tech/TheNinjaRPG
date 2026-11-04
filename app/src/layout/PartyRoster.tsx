import { Check, Crown, UserRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "@/layout/Link";

/** Shared party display; each activity supplies its own status and removal permissions. */
export const PartyRoster = ({
  members,
  leaderId,
  viewerId,
  disabled,
  onRemove,
  capacity,
}: PartyRosterProps) => (
  <ul className="grid gap-2 text-sm sm:grid-cols-3" aria-label="Party members">
    {members.map((member) => (
      <li
        key={member.userId}
        className="flex min-w-0 items-center gap-2 rounded-lg border bg-background/50 p-3"
      >
        <UserRound
          className="h-4 w-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <Link
              href={`/userid/${member.userId}`}
              className="truncate font-medium"
              title={member.username}
            >
              {member.username}
            </Link>
            {member.userId === leaderId && (
              <Crown
                className="h-3.5 w-3.5 shrink-0 text-primary"
                aria-label="Team leader"
              />
            )}
          </div>
          {member.details && (
            <p className="mt-0.5 flex items-center gap-1 text-muted-foreground text-xs">
              {member.isReady && (
                <Check className="h-3 w-3 text-green-600" aria-hidden="true" />
              )}
              {member.details}
            </p>
          )}
        </div>
        {onRemove && viewerId === leaderId && member.userId !== viewerId && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${member.username}`}
            hoverText={`Remove ${member.username}`}
            disabled={disabled}
            onClick={() => onRemove(member.userId)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </li>
    ))}
    {Array.from({ length: Math.max(0, capacity - members.length) }, (_, index) => (
      <li
        key={`open-${index}`}
        className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-muted-foreground"
      >
        <UserRound className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs">Open spot</span>
      </li>
    ))}
  </ul>
);

/** Activity-owned roster display; omit removal outside editable phases and enforce permissions server-side. */
type PartyRosterProps = {
  members: { userId: string; username: string; details?: string; isReady?: boolean }[];
  capacity: number;
  leaderId: string;
  viewerId: string;
  disabled?: boolean;
  onRemove?: (userId: string) => void;
};
