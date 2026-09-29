"use client";

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  ExternalLink,
  Pencil,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  type ContentProposalRejectReason,
  ContentProposalRejectReasons,
} from "@/drizzle/constants";
import BattlefieldPreview from "@/layout/BattlefieldPreview";
import ContentImage from "@/layout/ContentImage";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { battlefieldSceneOf } from "@/libs/contentReview/battlefield";
import {
  CATEGORY_LABELS,
  REJECT_REASON_LABELS,
  STATUS_LABELS,
} from "@/libs/contentReview/labels";
import { isMediaPath, setAtPath, topLevelField } from "@/libs/contentReview/paths";
import { showMutationToast } from "@/libs/toast";
import { formatSoundLength, formatTimeAgo } from "@/utils/time";
import { flattenLeaves, wordDiff } from "@/utils/wordDiff";

type Proposal = NonNullable<RouterOutputs["contentReview"]["getProposal"]>;
type Change = Proposal["changes"][number];
type Media = Change["media"][number];
type Asset = Proposal["assets"][string];

interface ContentReviewDetailProps {
  id: string;
  position: { index: number; total: number };
  onMove: (delta: number) => void;
  onDecided: () => void;
}

/** One suggestion: what changes, why, what it rests on, and the decision controls. */
export const ContentReviewDetail: React.FC<ContentReviewDetailProps> = (props) => {
  const { id, position, onMove, onDecided } = props;
  const utils = api.useUtils();
  const { data: proposal, isPending } = api.contentReview.getProposal.useQuery({ id });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [mediaChoice, setMediaChoice] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] =
    useState<ContentProposalRejectReason>("NOT_AN_IMPROVEMENT");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<"proposed" | "current">("proposed");
  const [isApproveArmed, setIsApproveArmed] = useState(false);
  const [hasPickedReason, setHasPickedReason] = useState(false);

  const refresh = async () => {
    await Promise.all([
      utils.contentReview.getQueue.invalidate(),
      utils.contentReview.getCounts.invalidate(),
      utils.contentReview.getProposal.invalidate({ id }),
      utils.profile.getUser.invalidate(),
    ]);
  };
  const decided = {
    onSuccess: async (data: { success: boolean; message: string }) => {
      showMutationToast(data);
      await refresh();
      if (data.success) onDecided();
    },
  };
  const approve = api.contentReview.approve.useMutation(decided);
  const reject = api.contentReview.reject.useMutation(decided);
  const revert = api.contentReview.revert.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refresh();
    },
  });
  const busy = approve.isPending || reject.isPending || revert.isPending;

  const isPendingProposal = proposal?.status === "PENDING" && proposal.canReview;
  const hasText = !!proposal?.changes.some((change) =>
    Object.values(change.after).some((value) => typeof value === "string"),
  );

  const doApprove = () => {
    if (!proposal || !isPendingProposal || busy) return;
    approve.mutate({
      id: proposal.id,
      exclude: [...excluded].map((key) => {
        const [changeId = "", field = ""] = key.split("|");
        return { changeId, field };
      }),
      edits: Object.entries(edits).map(([key, value]) => {
        const [changeId = "", field = ""] = key.split("|");
        return { changeId, field, value };
      }),
      media: Object.values(mediaChoice).map((mediaId) => ({ mediaId })),
    });
  };
  const doReject = () => {
    if (!proposal || !isPendingProposal || busy) return;
    reject.mutate({ id: proposal.id, reason, note: note.trim() || null });
  };

  // Keyboard review: J/K move, A twice approves, R then a reason number and Enter rejects, E
  // edits text. Typing in a field and open dialogs are left alone. Deciding always takes a
  // deliberate second key, so text typed while no field has focus cannot decide a suggestion.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (document.querySelector("[role='dialog']")) return;
      const key = event.key.toLowerCase();
      if (event.repeat && ["a", "r", "enter"].includes(key)) return;
      // While a rejection is being written, only its own keys act: no approving or moving on.
      if (rejecting) {
        if (/^[1-5]$/.test(key)) {
          const next = ContentProposalRejectReasons[Number(key) - 1];
          if (next) setReason(next);
          setHasPickedReason(true);
        } else if (key === "enter") {
          // A focused button, link or the reason select acts on its own Enter.
          if (target?.closest("button, a, [role='combobox'], [role='listbox']")) return;
          if (hasPickedReason) doReject();
        } else if (key === "escape" || key === "r") {
          setRejecting(false);
          setHasPickedReason(false);
        } else {
          return;
        }
        event.preventDefault();
      } else if (isApproveArmed) {
        // Only a second A confirms; any other key cancels.
        setIsApproveArmed(false);
        if (key === "a") {
          event.preventDefault();
          doApprove();
        }
      } else if (key === "escape") {
        setRejecting(false);
        setEditing(false);
      } else if (key === "j") {
        onMove(1);
      } else if (key === "k") {
        onMove(-1);
      } else if (key === "a" && isPendingProposal) {
        setIsApproveArmed(true);
      } else if (key === "r" && isPendingProposal) {
        setRejecting((value) => !value);
      } else if (key === "e" && isPendingProposal && hasText) {
        setEditing((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  if (isPending) return <Loader explanation="Loading suggestion" />;
  if (!proposal) return <p className="p-3">This suggestion no longer exists.</p>;

  const fieldKey = (change: Change, field: string) => `${change.id}|${field}`;
  const chosenFor = (change: Change, path: string) => {
    const candidates = change.media.filter((media) => media.path === path);
    return (
      candidates.find((media) => media.id === mediaChoice[`${change.id}|${path}`]) ??
      candidates.find((media) => media.chosen) ??
      candidates[0]
    );
  };
  /** Proposed top-level values after the reviewer's edits, exclusions and media picks. */
  const proposedFields = (change: Change) => {
    let fields: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(change.applied ?? change.after)) {
      if (excluded.has(fieldKey(change, field))) continue;
      fields[field] = edits[fieldKey(change, field)] ?? value;
    }
    for (const path of new Set(change.media.map((media) => media.path))) {
      const field = topLevelField(path);
      const pick = chosenFor(change, path);
      if (!(field in fields) || !pick) continue;
      // A sound that is not in the catalog yet keeps the server's `media:` placeholder, now
      // naming the chosen candidate, so the battlefield can play it from its URL.
      const value =
        pick.kind === "IMAGE"
          ? pick.url
          : pick.source === "CATALOG"
            ? pick.externalId
            : pick.kind === "SFX"
              ? mediaPlaceholder(pick.id)
              : null;
      if (value) fields = setAtPath(fields, path, value);
    }
    return fields;
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-popover p-3 text-popover-foreground">
      <div className="flex items-center justify-between gap-2 text-sm md:hidden">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onMove(-1)}
          disabled={position.index <= 0}
        >
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <span>
          {position.index + 1} of {position.total}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onMove(1)}
          disabled={position.index >= position.total - 1}
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <CategoryBadge category={proposal.category} />
          {proposal.targets.map((target) => (
            <Badge key={`${target.entityType}-${target.entityId}`} variant="outline">
              {target.operation === "CREATE" ? `New ${target.label}` : target.label}
            </Badge>
          ))}
          <Badge variant={proposal.status === "PENDING" ? "secondary" : "outline"}>
            {STATUS_LABELS[proposal.status]}
          </Badge>
          {proposal.expiresAt && proposal.status === "PENDING" && (
            <Badge variant="outline">
              Evidence expires {new Date(proposal.expiresAt).toLocaleDateString()}
            </Badge>
          )}
        </div>
        <h2 className="font-bold text-xl">{proposal.title}</h2>
        <div className="flex flex-wrap gap-x-3 text-sm">
          {proposal.changes.map((change) =>
            change.detailHref ? (
              <Link
                key={change.id}
                href={change.detailHref}
                className="inline-flex items-center gap-1 font-bold hover:text-orange-500"
              >
                {change.name} <ExternalLink className="h-3 w-3" />
              </Link>
            ) : (
              <span key={change.id} className="font-bold">
                {change.name}
              </span>
            ),
          )}
        </div>
        <p className="text-xs opacity-80">
          {proposal.source === "AGENT"
            ? `Daily audit · ${proposal.agentName ?? "agent"}`
            : `Suggested by ${proposal.createdBy ?? "staff"}`}{" "}
          · {formatTimeAgo(new Date(proposal.createdAt))}
          {proposal.runUrl && (
            <>
              {" · "}
              <a
                href={proposal.runUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                run log
              </a>
            </>
          )}
          {proposal.confidence !== null && ` · confidence ${proposal.confidence}%`}
        </p>
      </header>

      <StatusBanner proposal={proposal} />

      <section>
        <h3 className="mb-1 font-bold text-xs uppercase tracking-wide opacity-70">
          Why
        </h3>
        <p className="whitespace-pre-line text-sm">
          <WithPlaceholders text={proposal.rationale} />
        </p>
      </section>

      {proposal.changes.map((change) => {
        const mediaPaths = [...new Set(change.media.map((media) => media.path))];
        const values = change.applied ?? change.after;
        return (
          <section key={change.id} className="flex flex-col gap-2">
            <h3 className="font-bold text-xs uppercase tracking-wide opacity-70">
              {change.operation === "CREATE" ? "New" : "Changes to"} {change.label} ·{" "}
              {change.name}
            </h3>
            {Object.keys(values).map((field) => {
              const key = fieldKey(change, field);
              const off = excluded.has(key);
              return (
                <div key={key} className="overflow-hidden rounded-lg border">
                  <label className="flex cursor-pointer items-center gap-2 bg-poppopover px-2 py-1 text-xs">
                    <input
                      type="checkbox"
                      checked={!off}
                      disabled={!isPendingProposal}
                      onChange={() =>
                        setExcluded((previous) => {
                          const next = new Set(previous);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })
                      }
                    />
                    <code className="font-semibold">{field}</code>
                    {edits[key] !== undefined && (
                      <span className="font-bold text-orange-500 uppercase">
                        edited
                      </span>
                    )}
                  </label>
                  <div className={`p-2 text-sm ${off ? "opacity-40" : ""}`}>
                    {isMediaPath("IMAGE", field) ? (
                      <ImageDiff
                        before={change.before[field] ?? null}
                        after={
                          chosenFor(change, field)?.url ??
                          edits[key] ??
                          values[field] ??
                          null
                        }
                        editing={
                          editing &&
                          isPendingProposal &&
                          !off &&
                          !mediaPaths.includes(field)
                        }
                        onEdit={(value) =>
                          setEdits((previous) => ({ ...previous, [key]: value }))
                        }
                      />
                    ) : (
                      <FieldDiff
                        before={change.before[field] ?? null}
                        after={edits[key] ?? values[field] ?? null}
                        hidePaths={mediaPaths
                          .filter((path) => topLevelField(path) === field)
                          .map((path) => path.slice(field.length + 1))}
                        editing={editing && isPendingProposal && !off}
                        onEdit={(value) =>
                          setEdits((previous) => ({ ...previous, [key]: value }))
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {mediaPaths.map((path) => (
              <MediaChoice
                key={`${change.id}-${path}`}
                path={path}
                candidates={change.media.filter((media) => media.path === path)}
                assets={proposal.assets}
                chosen={chosenFor(change, path)}
                disabled={!isPendingProposal}
                onChoose={(mediaId) =>
                  setMediaChoice((previous) => ({
                    ...previous,
                    [`${change.id}|${path}`]: mediaId,
                  }))
                }
              />
            ))}
            <InTheGame
              change={change}
              proposed={{ ...change.payload, ...proposedFields(change) }}
              mode={preview}
              onMode={setPreview}
            />
          </section>
        );
      })}

      {proposal.basis.length > 0 && (
        <section>
          <h3 className="mb-1 font-bold text-xs uppercase tracking-wide opacity-70">
            Based on
          </h3>
          <ul className="flex flex-col gap-1 text-xs">
            {proposal.basis.map((basis) => (
              <li
                key={`${basis.entityType}-${basis.entityId}`}
                className="flex items-center gap-2"
              >
                {basis.fresh ? (
                  <CircleCheck className="h-4 w-4 text-green-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                <span>
                  {basis.label} {basis.name}
                  <span className="opacity-60">
                    {" "}
                    · {basis.role.toLowerCase()} · v {basis.version}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isPendingProposal && (
        <footer className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-popover pt-2">
          <Button
            variant="destructive"
            onClick={() => setRejecting((value) => !value)}
            disabled={busy}
          >
            <X className="mr-1 h-4 w-4" /> Reject <Kbd>R</Kbd>
          </Button>
          {hasText && (
            <Button
              variant="outline"
              onClick={() => setEditing((value) => !value)}
              disabled={busy}
            >
              <Pencil className="mr-1 h-4 w-4" /> {editing ? "Done editing" : "Edit"}{" "}
              <Kbd>E</Kbd>
            </Button>
          )}
          <span className="grow" />
          <Button
            onClick={doApprove}
            disabled={busy}
            loading={approve.isPending}
            className={isApproveArmed ? "ring-2 ring-green-600 ring-offset-2" : ""}
          >
            <Check className="mr-1 h-4 w-4" />{" "}
            {isApproveArmed ? "Press A again to apply" : "Approve and apply"}{" "}
            <Kbd>A</Kbd>
          </Button>
          {rejecting && (
            <div className="flex w-full flex-col gap-2 rounded-lg border bg-poppopover p-2">
              <Label htmlFor="reject-reason">
                Why reject? The next audit reads this. Pick a reason (keys 1 to 5), then
                press Enter.
              </Label>
              <Select
                value={reason}
                onValueChange={(value) => {
                  setReason(value as ContentProposalRejectReason);
                  setHasPickedReason(true);
                }}
              >
                <SelectTrigger id="reject-reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ContentProposalRejectReasons.map((entry, index) => (
                    <SelectItem key={entry} value={entry}>
                      {index + 1}. {REJECT_REASON_LABELS[entry]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea
                value={note}
                maxLength={500}
                placeholder="Optional note for the audit and the author"
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setRejecting(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={doReject}
                  loading={reject.isPending}
                >
                  Reject suggestion
                </Button>
              </div>
            </div>
          )}
        </footer>
      )}

      {proposal.status === "APPLIED" && proposal.canReview && (
        <footer className="flex justify-end border-t pt-2">
          <Button
            variant="outline"
            onClick={() => revert.mutate({ id: proposal.id })}
            loading={revert.isPending}
          >
            <Undo2 className="mr-1 h-4 w-4" /> Revert
          </Button>
        </footer>
      )}
    </div>
  );
};

/** The change as players meet it: its card and what it draws in battle, now or proposed. */
const InTheGame: React.FC<{
  change: Change;
  proposed: Record<string, unknown>;
  mode: "current" | "proposed";
  onMode: (mode: "current" | "proposed") => void;
}> = ({ change, proposed, mode, onMode }) => {
  const current = change.payload;
  const fields = mode === "current" ? current : proposed;
  const sounds = Object.fromEntries(
    change.media.flatMap((media) =>
      media.kind === "SFX" && media.url
        ? [[mediaPlaceholder(media.id), media.url]]
        : [],
    ),
  );
  const showCard = !!current && change.entityType !== "AI";
  const showField = [current, proposed].some(
    (entry) => entry && battlefieldSceneOf(change.entityType, change.entityId, entry),
  );
  if (!showCard && !showField) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-xs uppercase tracking-wide opacity-70">
          In the game
        </h3>
        <div className="flex overflow-hidden rounded-md border text-xs">
          {(["current", "proposed"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              className={`px-2 py-1 ${mode === entry ? "bg-primary text-primary-foreground" : ""}`}
              onClick={() => onMode(entry)}
            >
              {entry === "current" ? "Current" : "Proposed"}
            </button>
          ))}
        </div>
      </div>
      {showCard && fields && (
        <ItemWithEffects
          item={fields as Parameters<typeof ItemWithEffects>[0]["item"]}
          hideDates
        />
      )}
      {showField && (
        <div className="flex flex-col gap-1">
          <h4 className="font-bold text-xs opacity-70">On the battlefield</h4>
          {fields ? (
            <BattlefieldPreview
              entityType={change.entityType}
              entityId={change.entityId}
              fields={fields}
              sounds={sounds}
            />
          ) : (
            <p className="text-xs opacity-70">It does not exist yet.</p>
          )}
        </div>
      )}
    </div>
  );
};

export const CategoryBadge: React.FC<{ category: Proposal["category"] }> = ({
  category,
}) => (
  <span
    className={`inline-flex items-center rounded-md px-2 py-0.5 font-semibold text-xs ${CATEGORY_STYLES[category]}`}
  >
    {CATEGORY_LABELS[category]}
  </span>
);

const StatusBanner: React.FC<{ proposal: Proposal }> = ({ proposal }) => {
  const when = formatTimeAgo(new Date(proposal.statusChangedAt));
  if (proposal.status === "OUTDATED") {
    return (
      <div className="flex gap-2 rounded-lg bg-amber-100 p-2 text-amber-900 text-sm dark:bg-amber-900/30 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          <b>Outdated. </b>
          {proposal.outdatedReason ?? "Something it relied on changed"}. It left the
          queue and cannot be applied. The next audit can suggest it again from the
          current version.
        </span>
      </div>
    );
  }
  if (proposal.status === "APPLIED" || proposal.status === "REVERTED") {
    return (
      <div className="flex gap-2 rounded-lg bg-green-100 p-2 text-green-900 text-sm dark:bg-green-900/30 dark:text-green-200">
        <CircleCheck className="h-4 w-4 shrink-0" />
        <span>
          <b>{proposal.status === "APPLIED" ? "Applied" : "Reverted"}</b>
          {proposal.reviewedBy ? ` by ${proposal.reviewedBy}` : ""} {when}. Logged in
          the content ActionLog.
        </span>
      </div>
    );
  }
  if (proposal.status === "REJECTED") {
    return (
      <div className="flex gap-2 rounded-lg bg-red-100 p-2 text-red-900 text-sm dark:bg-red-900/30 dark:text-red-200">
        <CircleX className="h-4 w-4 shrink-0" />
        <span>
          <b>
            Rejected{proposal.reviewedBy ? ` by ${proposal.reviewedBy}` : ""} {when}:{" "}
          </b>
          {proposal.rejectReason ? REJECT_REASON_LABELS[proposal.rejectReason] : ""}
          {proposal.reviewNote ? `. “${proposal.reviewNote}”` : ""}
        </span>
      </div>
    );
  }
  return null;
};

/** Text with combat placeholders such as %user shown as tokens. */
const WithPlaceholders: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(%[a-z_]+)/gi).map((part, index) =>
      /^%[a-z_]+$/i.test(part) ? (
        <code key={index} className="rounded bg-poppopover px-1 font-semibold text-xs">
          {part}
        </code>
      ) : (
        part
      ),
    )}
  </>
);

/** Word diff for text, old → new for scalars, and changed leaves for lists and objects. */
const FieldDiff: React.FC<{
  before: unknown;
  after: unknown;
  hidePaths: string[];
  editing: boolean;
  onEdit: (value: string) => void;
}> = ({ before, after, hidePaths, editing, onEdit }) => {
  if (typeof after === "string" && (typeof before === "string" || before === null)) {
    return (
      <div className="flex flex-col gap-2">
        {editing && (
          <Textarea
            value={after}
            onChange={(e) => onEdit(e.target.value)}
            className="min-h-24"
          />
        )}
        <p className="whitespace-pre-wrap leading-relaxed">
          {wordDiff(before ?? "", after).map((part, index) =>
            part.op === "same" ? (
              <WithPlaceholders key={index} text={part.text} />
            ) : part.op === "removed" ? (
              <del
                key={index}
                className="rounded bg-red-200 px-0.5 text-red-900 dark:bg-red-900/40 dark:text-red-100"
              >
                {part.text}
              </del>
            ) : (
              <ins
                key={index}
                className="rounded bg-green-200 px-0.5 text-green-900 no-underline dark:bg-green-900/40 dark:text-green-100"
              >
                {part.text}
              </ins>
            ),
          )}
        </p>
      </div>
    );
  }
  const isScalar = (value: unknown) => value === null || typeof value !== "object";
  if (isScalar(before) && isScalar(after)) {
    const delta =
      typeof before === "number" && typeof after === "number" && before !== 0
        ? Math.round(((after - before) / Math.abs(before)) * 100)
        : null;
    return (
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="line-through opacity-60">{formatScalar(before)}</span>
        <span>→</span>
        <span className="font-bold">{formatScalar(after)}</span>
        {delta !== null && (
          <span className="rounded bg-poppopover px-1 font-bold text-xs">
            {delta > 0 ? "+" : ""}
            {delta}%
          </span>
        )}
      </div>
    );
  }
  const old = flattenLeaves(before);
  const next = flattenLeaves(after);
  const rows = [...new Set([...old.keys(), ...next.keys()])].filter(
    (path) =>
      formatScalar(old.get(path)) !== formatScalar(next.get(path)) &&
      !hidePaths.some((hidden) => path === hidden || path.startsWith(`${hidden}.`)),
  );
  if (rows.length === 0) {
    return <p className="text-xs opacity-70">Only the media below changes here.</p>;
  }
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((path) => (
          <tr key={path} className="border-t first:border-t-0">
            <td className="py-1 pr-2 font-mono">{path}</td>
            <td className="py-1 pr-2 line-through opacity-60">
              {formatScalar(old.get(path))}
            </td>
            <td className="py-1 font-bold">{formatScalar(next.get(path))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/** Current and proposed picture of an image field, shown instead of their URLs. */
const ImageDiff: React.FC<{
  before: unknown;
  after: unknown;
  editing: boolean;
  onEdit: (value: string) => void;
}> = ({ before, after, editing, onEdit }) => {
  const pictures = [
    ["Current", typeof before === "string" ? before : ""],
    ["Proposed", typeof after === "string" ? after : ""],
  ] as const;
  return (
    <div className="flex flex-col gap-2">
      {editing && (
        <Textarea
          value={pictures[1][1]}
          onChange={(e) => onEdit(e.target.value)}
          className="min-h-12"
        />
      )}
      <div className="flex flex-wrap gap-4">
        {pictures.map(([label, url]) =>
          label === "Current" && !url ? null : (
            <figure key={label} className="flex flex-col gap-1">
              <figcaption className="font-bold text-xs uppercase opacity-70">
                {label}
              </figcaption>
              {url ? (
                <div className="h-32 w-32">
                  <ContentImage image={url} alt={`${label} image`} className="" />
                </div>
              ) : (
                <p className="text-xs opacity-70">No image</p>
              )}
            </figure>
          ),
        )}
      </div>
    </div>
  );
};

/** Current asset and the candidates for one media field, each playable, one to pick. */
const MediaChoice: React.FC<{
  path: string;
  candidates: Media[];
  assets: Record<string, Asset>;
  chosen: Media | undefined;
  disabled: boolean;
  onChoose: (mediaId: string) => void;
}> = ({ path, candidates, assets, chosen, disabled, onChoose }) => {
  const kind = candidates[0]?.kind ?? "SFX";
  const currentId = candidates[0]?.currentValue ?? null;
  const current = currentId ? assets[currentId] : undefined;
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2">
      <h3 className="font-bold text-xs uppercase tracking-wide opacity-70">
        <code>{path}</code> · pick the {kind === "SFX" ? "sound" : kind.toLowerCase()}
      </h3>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border bg-card p-2 text-card-foreground">
          <p className="font-bold text-xs uppercase opacity-70">Current</p>
          <p className="truncate font-bold text-sm">
            {kind === "IMAGE" ? "Current image" : (current?.name ?? "Nothing set")}
          </p>
          <MediaPreview
            kind={kind}
            url={kind === "IMAGE" ? currentId : null}
            asset={current}
          />
        </div>
        {candidates.map((media, index) => {
          const asset = media.externalId ? assets[media.externalId] : undefined;
          const isChosen = chosen?.id === media.id;
          return (
            <label
              key={media.id}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border bg-card p-2 text-card-foreground ${isChosen ? "border-green-600 ring-1 ring-green-600" : ""}`}
            >
              <span className="flex items-center gap-2 text-xs">
                <input
                  type="radio"
                  name={`media-${path}-${candidates[0]?.id}`}
                  checked={isChosen}
                  disabled={disabled}
                  onChange={() => onChoose(media.id)}
                />
                <span className="font-bold uppercase opacity-70">
                  {MEDIA_KIND_LABELS[media.kind]} proposal {index + 1}
                </span>
                {media.chosen && <Badge variant="outline">Used</Badge>}
              </span>
              <span className="truncate font-bold text-sm">{media.title}</span>
              <MediaPreview kind={media.kind} url={media.url} asset={asset} />
              {media.lengthMs !== null && (
                <span className="text-xs opacity-70">
                  {formatSoundLength(media.lengthMs)}
                </span>
              )}
              {media.source === "EPIDEMIC" && (
                <span className="text-xs opacity-70">
                  Approving adds it to the asset library.
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
};

const MediaPreview: React.FC<{
  kind: Media["kind"];
  url: string | null;
  asset: Asset | undefined;
}> = ({ kind, url, asset }) => {
  if (kind === "SFX") {
    const src = url ?? asset?.url;
    return src ? (
      // biome-ignore lint/a11y/useMediaCaption: sound effects have no speech to caption
      <audio controls preload="none" className="w-full" src={src} />
    ) : (
      <p className="text-xs opacity-70">No sound</p>
    );
  }
  if (kind === "ANIMATION") {
    return asset ? (
      <div className="h-24 w-24">
        <ContentImage
          image={asset.image}
          alt={asset.name}
          frames={asset.frames}
          speed={asset.speed}
          className=""
        />
      </div>
    ) : (
      <p className="text-xs opacity-70">No animation</p>
    );
  }
  const src = url ?? asset?.image;
  return src ? (
    <div className="h-32 w-32">
      <ContentImage image={src} alt="Candidate image" className="" />
    </div>
  ) : (
    <p className="text-xs opacity-70">No image</p>
  );
};

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="ml-2 hidden rounded border border-current/40 px-1 text-[10px] opacity-70 md:inline">
    {children}
  </kbd>
);

/** How the server writes a media field whose candidate is not in the catalog yet. */
const mediaPlaceholder = (mediaId: string) => `media:${mediaId}`;

const formatScalar = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const MEDIA_KIND_LABELS: Record<Media["kind"], string> = {
  SFX: "SFX",
  IMAGE: "Image",
  ANIMATION: "Animation",
};

const CATEGORY_STYLES: Record<Proposal["category"], string> = {
  GRAMMAR: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
  BALANCE: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  SOUND: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100",
  ANIMATION:
    "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/40 dark:text-fuchsia-100",
  VISUAL: "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-100",
  CONSISTENCY: "bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100",
  NEW_CONTENT: "bg-green-100 text-green-900 dark:bg-green-900/40 dark:text-green-100",
};

export default ContentReviewDetail;
