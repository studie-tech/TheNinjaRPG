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
  CONTENT_PROPOSAL_NOTE_MAX_LENGTH,
  type ContentProposalRejectReason,
  ContentProposalRejectReasons,
} from "@/drizzle/constants";
import { BattlefieldPreview } from "@/layout/BattlefieldPreview";
import ContentImage from "@/layout/ContentImage";
import ItemWithEffects from "@/layout/ItemWithEffects";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { QuestDialogScene } from "@/layout/Logbook";
import { battlefieldSceneOf } from "@/libs/contentReview/battlefield";
import {
  CATEGORY_LABELS,
  REJECT_REASON_LABELS,
  STATUS_LABELS,
} from "@/libs/contentReview/labels";
import {
  isMediaPath,
  isSceneAssetPath,
  isSceneCharacterPath,
  setAtPath,
  topLevelField,
} from "@/libs/contentReview/paths";
import { questSceneOf } from "@/libs/contentReview/questScene";
import { showMutationToast } from "@/libs/toast";
import { formatSoundLength, formatTimeAgo } from "@/utils/time";
import { flattenLeaves, wordDiff } from "@/utils/wordDiff";

interface ContentReviewDetailProps {
  id: string;
  /** Place of this suggestion in the loaded queue. */
  position: { index: number; total: number };
  /** Select the suggestion `delta` places further down the queue; negative moves up. */
  onMove: (delta: number) => void;
  /** Called once an approval or a rejection has succeeded. */
  onDecided: () => void;
}

/**
 * One suggestion: what changes, why, what it rests on, and the decision controls. Before
 * approving, a reviewer can leave fields out, rewrite text and pick among media candidates.
 */
export const ContentReviewDetail: React.FC<ContentReviewDetailProps> = (props) => {
  const { data: proposal, isPending } = api.contentReview.getProposal.useQuery({
    id: props.id,
  });
  if (isPending) return <Loader explanation="Loading suggestion" />;
  if (!proposal) return <p className="p-3">This suggestion no longer exists.</p>;

  // Refinements replace the draft, so choices and keyboard confirmation belong only to
  // the revision the reviewer saw when making them.
  return (
    <ProposalReview
      key={`${proposal.id}:${proposal.statusChangedAt.valueOf()}`}
      {...props}
      proposal={proposal}
    />
  );
};

const ProposalReview: React.FC<ContentReviewDetailProps & { proposal: Proposal }> = (
  props,
) => {
  const { id, position, onMove, onDecided, proposal } = props;
  const utils = api.useUtils();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [mediaChoice, setMediaChoice] = useState<Record<string, string>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [reason, setReason] =
    useState<ContentProposalRejectReason>("NOT_AN_IMPROVEMENT");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<PreviewMode>("proposed");
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
  const decisionOptions = {
    onSuccess: async (data: { success: boolean; message: string }) => {
      showMutationToast(data);
      await refresh();
      if (data.success) onDecided();
    },
  };
  const approve = api.contentReview.approve.useMutation(decisionOptions);
  const reject = api.contentReview.reject.useMutation(decisionOptions);
  const revert = api.contentReview.revert.useMutation({
    onSuccess: async (data) => {
      showMutationToast(data);
      await refresh();
    },
  });
  const isBusy = approve.isPending || reject.isPending || revert.isPending;

  const canDecide = proposal?.status === "PENDING" && proposal.canReview;
  const hasText = !!proposal?.changes.some((change) =>
    Object.values(change.after).some((value) => typeof value === "string"),
  );

  const doApprove = () => {
    if (!proposal || !canDecide || isBusy) return;
    approve.mutate({
      id: proposal.id,
      expectedStatusChangedAt: proposal.statusChangedAt.toISOString(),
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
    if (!proposal || !canDecide || isBusy) return;
    reject.mutate({
      id: proposal.id,
      expectedStatusChangedAt: proposal.statusChangedAt.toISOString(),
      reason,
      note: note.trim() || null,
    });
  };
  const toggleField = (key: string) =>
    setExcluded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const editField = (key: string, value: string) =>
    setEdits((previous) => ({ ...previous, [key]: value }));
  const chooseMedia = (key: string, mediaId: string) =>
    setMediaChoice((previous) => ({ ...previous, [key]: mediaId }));
  // Opening or closing the rejection starts it over, so Enter always needs a fresh reason.
  const showRejectForm = (isShown: boolean) => {
    setIsRejecting(isShown);
    setHasPickedReason(false);
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
      if (isRejecting) {
        const pickedReason = /^[1-9]$/.test(key)
          ? ContentProposalRejectReasons[Number(key) - 1]
          : undefined;
        if (pickedReason) {
          setReason(pickedReason);
          setHasPickedReason(true);
        } else if (key === "enter") {
          // A focused button, link or the reason select acts on its own Enter.
          if (target?.closest("button, a, [role='combobox'], [role='listbox']")) return;
          if (hasPickedReason) doReject();
        } else if (key === "escape" || key === "r") {
          showRejectForm(false);
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
        setIsRejecting(false);
        setIsEditing(false);
      } else if (key === "j") {
        onMove(1);
      } else if (key === "k") {
        onMove(-1);
      } else if (key === "a" && canDecide) {
        setIsApproveArmed(true);
      } else if (key === "r" && canDecide) {
        showRejectForm(true);
      } else if (key === "e" && canDecide && hasText) {
        setIsEditing((value) => !value);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const choices: ReviewChoices = { excluded, edits, mediaChoice };

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-popover p-3 text-popover-foreground">
      <QueueStepper position={position} onMove={onMove} />
      <ProposalHeader proposal={proposal} />
      <StatusBanner proposal={proposal} />

      <section>
        <h3 className="mb-1 font-bold text-xs uppercase tracking-wide opacity-70">
          Why
        </h3>
        <p className="whitespace-pre-line text-sm">
          <WithPlaceholders text={proposal.rationale} />
        </p>
      </section>

      {proposal.changes.map((change) => (
        <ChangeReview
          key={change.id}
          change={change}
          assets={proposal.assets}
          choices={choices}
          canDecide={canDecide}
          isEditing={isEditing}
          preview={preview}
          onPreviewChange={setPreview}
          onToggleField={toggleField}
          onEdit={editField}
          onChooseMedia={chooseMedia}
        />
      ))}

      {proposal.basis.length > 0 && <BasisList basis={proposal.basis} />}

      {canDecide && (
        <footer className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-popover pt-2">
          <Button
            variant="destructive"
            onClick={() => showRejectForm(!isRejecting)}
            disabled={isBusy}
          >
            <X className="mr-1 h-4 w-4" /> Reject <Kbd>R</Kbd>
          </Button>
          {hasText && (
            <Button
              variant="outline"
              onClick={() => setIsEditing((value) => !value)}
              disabled={isBusy}
            >
              <Pencil className="mr-1 h-4 w-4" /> {isEditing ? "Done editing" : "Edit"}{" "}
              <Kbd>E</Kbd>
            </Button>
          )}
          <span className="grow" />
          <Button
            onClick={doApprove}
            disabled={isBusy}
            loading={approve.isPending}
            className={isApproveArmed ? "ring-2 ring-green-600 ring-offset-2" : ""}
          >
            <Check className="mr-1 h-4 w-4" />{" "}
            {isApproveArmed ? "Press A again to apply" : "Approve and apply"}{" "}
            <Kbd>A</Kbd>
          </Button>
          {isRejecting && (
            <RejectForm
              reason={reason}
              note={note}
              isSubmitting={reject.isPending}
              onReasonChange={(value) => {
                setReason(value);
                setHasPickedReason(true);
              }}
              onNoteChange={setNote}
              onCancel={() => showRejectForm(false)}
              onSubmit={doReject}
            />
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

/** A suggestion's category as a colored label. */
export const CategoryBadge: React.FC<{ category: Proposal["category"] }> = ({
  category,
}) => (
  <span
    className={`inline-flex items-center rounded-md px-2 py-0.5 font-semibold text-xs ${CATEGORY_STYLES[category]}`}
  >
    {CATEGORY_LABELS[category]}
  </span>
);

/** Prev and next buttons for small screens, where the desk hides the queue list. */
const QueueStepper: React.FC<{
  position: ContentReviewDetailProps["position"];
  onMove: (delta: number) => void;
}> = ({ position, onMove }) => (
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
);

/** Badges, title, links to the live entries, and who suggested it and when. */
const ProposalHeader: React.FC<{ proposal: Proposal }> = ({ proposal }) => (
  <header className="flex flex-col gap-1">
    <div className="flex flex-wrap items-center gap-1">
      <CategoryBadge category={proposal.category} />
      {proposal.targets.map((target, index) => (
        <Badge
          key={`${target.entityType}-${target.entityId ?? index}`}
          variant="outline"
        >
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
        ? `Content audit · ${proposal.agentName ?? "agent"}`
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
);

/** Outcome of a decided or outdated suggestion; nothing while it is pending. */
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

/**
 * One change of a suggestion: a diff per field with a checkbox to leave it out, a picker per
 * media field, and the result in the game. Every choice is keyed by `fieldKey`.
 */
const ChangeReview: React.FC<{
  change: Change;
  assets: Record<string, Asset>;
  choices: ReviewChoices;
  canDecide: boolean;
  isEditing: boolean;
  preview: PreviewMode;
  onPreviewChange: (mode: PreviewMode) => void;
  onToggleField: (key: string) => void;
  onEdit: (key: string, value: string) => void;
  onChooseMedia: (key: string, mediaId: string) => void;
}> = (props) => {
  const { change, assets, choices, canDecide, isEditing, preview } = props;
  const { onPreviewChange, onToggleField, onEdit, onChooseMedia } = props;
  const mediaPaths = [...new Set(change.media.map((media) => media.path))];
  const values = change.applied ?? change.after;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-bold text-xs uppercase tracking-wide opacity-70">
        {change.operation === "CREATE" ? "New" : "Changes to"} {change.label} ·{" "}
        {change.name}
      </h3>
      {Object.keys(values).map((field) => {
        const key = fieldKey(change, field);
        const isExcluded = choices.excluded.has(key);
        return (
          <div key={key} className="overflow-hidden rounded-lg border">
            <label className="flex cursor-pointer items-center gap-2 bg-poppopover px-2 py-1 text-xs">
              <input
                type="checkbox"
                checked={!isExcluded}
                disabled={!canDecide}
                onChange={() => onToggleField(key)}
              />
              <code className="font-semibold">{field}</code>
              {choices.edits[key] !== undefined && (
                <span className="font-bold text-orange-500 uppercase">edited</span>
              )}
            </label>
            <div className={`p-2 text-sm ${isExcluded ? "opacity-40" : ""}`}>
              {isMediaPath("IMAGE", field) ? (
                <ImageDiff
                  before={change.before[field] ?? null}
                  after={
                    chosenMedia(change, field, choices.mediaChoice)?.url ??
                    choices.edits[key] ??
                    values[field] ??
                    null
                  }
                  isEditing={
                    isEditing && canDecide && !isExcluded && !mediaPaths.includes(field)
                  }
                  onEdit={(value) => onEdit(key, value)}
                />
              ) : (
                <FieldDiff
                  path={field}
                  assets={assets}
                  before={change.before[field] ?? null}
                  after={choices.edits[key] ?? values[field] ?? null}
                  hidePaths={mediaPaths
                    .filter((path) => topLevelField(path) === field)
                    .map((path) => path.slice(field.length + 1))}
                  isEditing={isEditing && canDecide && !isExcluded}
                  onEdit={(value) => onEdit(key, value)}
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
          assets={assets}
          chosen={chosenMedia(change, path, choices.mediaChoice)}
          isDisabled={!canDecide}
          onChoose={(mediaId) => onChooseMedia(fieldKey(change, path), mediaId)}
        />
      ))}
      <InTheGame
        change={change}
        assets={assets}
        proposed={{ ...change.payload, ...proposedFields(change, choices) }}
        mode={preview}
        onModeChange={onPreviewChange}
      />
    </section>
  );
};

/**
 * Word diff for text, old → new for scalars, and changed leaves for lists and objects.
 * Leaves under `hidePaths` are left to the media pickers that show them.
 */
const FieldDiff: React.FC<{
  path: string;
  assets: Record<string, Asset>;
  before: unknown;
  after: unknown;
  hidePaths: string[];
  isEditing: boolean;
  onEdit: (value: string) => void;
}> = ({ path: fieldPath, assets, before, after, hidePaths, isEditing, onEdit }) => {
  if (isSceneAssetPath(fieldPath)) {
    return (
      <ImageDiff
        before={before}
        after={after}
        assets={assets}
        isAssetReference
        isEditing={false}
        onEdit={onEdit}
      />
    );
  }
  if (typeof after === "string" && (typeof before === "string" || before === null)) {
    return (
      <div className="flex flex-col gap-2">
        {isEditing && (
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
        {rows.map((path) => {
          const fullPath = path ? `${fieldPath}.${path}` : fieldPath;
          const isAssetReference = isSceneAssetPath(fullPath);
          return (
            <tr key={path} className="border-t first:border-t-0">
              <td className="break-all py-1 pr-2 align-top font-mono">{path}</td>
              {isAssetReference || isMediaPath("IMAGE", fullPath) ? (
                <td colSpan={2} className="py-1">
                  <ImageDiff
                    before={old.get(path)}
                    after={next.get(path)}
                    assets={assets}
                    isAssetReference={isAssetReference}
                    isEditing={false}
                    onEdit={onEdit}
                  />
                </td>
              ) : (
                <>
                  <td className="py-1 pr-2 line-through opacity-60">
                    {formatScalar(old.get(path))}
                  </td>
                  <td className="py-1 font-bold">{formatScalar(next.get(path))}</td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

/** Current and proposed picture of an image field; editing rewrites the proposed URL. */
const ImageDiff: React.FC<{
  before: unknown;
  after: unknown;
  assets?: Record<string, Asset>;
  isAssetReference?: boolean;
  isEditing: boolean;
  onEdit: (value: string) => void;
}> = ({ before, after, assets = {}, isAssetReference = false, isEditing, onEdit }) => {
  const pictures = [
    ["Current", typeof before === "string" ? before : ""],
    ["Proposed", typeof after === "string" ? after : ""],
  ] as const;
  return (
    <div className="flex flex-col gap-2">
      {isEditing && (
        <Textarea
          value={pictures[1][1]}
          onChange={(e) => onEdit(e.target.value)}
          className="min-h-12"
        />
      )}
      <div className="flex flex-wrap gap-4">
        {pictures.map(([label, value]) => {
          const asset = isAssetReference ? assets[value] : undefined;
          const url = isAssetReference ? asset?.image : value;
          return label === "Current" && !value ? null : (
            <figure key={label} className="flex flex-col gap-1">
              <figcaption className="font-bold text-xs uppercase opacity-70">
                {label}
              </figcaption>
              {url ? (
                <div className="h-32 w-32">
                  <ContentImage
                    image={url}
                    alt={asset?.name ?? `${label} image`}
                    className="object-contain"
                  />
                </div>
              ) : (
                <p className="text-xs opacity-70">
                  {value ? "Image unavailable" : "No image"}
                </p>
              )}
              {isAssetReference && value && (
                <span className="max-w-32 break-all text-xs">
                  {asset?.name ?? value}
                </span>
              )}
            </figure>
          );
        })}
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
  isDisabled: boolean;
  onChoose: (mediaId: string) => void;
}> = ({ path, candidates, assets, chosen, isDisabled, onChoose }) => {
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
            {kind === "IMAGE" && !isSceneCharacterPath(path)
              ? "Current image"
              : (current?.name ?? "Nothing set")}
          </p>
          <MediaPreview
            kind={kind}
            url={
              kind === "IMAGE"
                ? isSceneCharacterPath(path)
                  ? (current?.image ?? null)
                  : currentId
                : null
            }
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
                  disabled={isDisabled}
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

/**
 * A sound player, an animated sprite or a picture for one media value. A candidate's own `url`
 * wins over its catalog asset; animations always draw from the asset.
 */
const MediaPreview: React.FC<{
  kind: Media["kind"];
  url: string | null;
  asset: Asset | undefined;
}> = ({ kind, url, asset }) => {
  if (kind === "SFX") {
    const src = url ?? asset?.url;
    return src ? (
      // oxlint-disable-next-line jsx-a11y/media-has-caption -- sound effects have no speech to caption
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

/**
 * The change as players meet it: its card, quest scene or battlefield, current or proposed.
 * Renders nothing when the entity has neither.
 */
const InTheGame: React.FC<{
  change: Change;
  assets: Record<string, Asset>;
  proposed: Record<string, unknown>;
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
}> = ({ change, assets, proposed, mode, onModeChange }) => {
  const [questSceneLabel, setQuestSceneLabel] = useState("");
  const current = change.payload;
  const fields = mode === "current" ? current : proposed;
  const sounds = Object.fromEntries(
    change.media.flatMap((media) =>
      media.kind === "SFX" && media.url
        ? [[mediaPlaceholder(media.id), media.url]]
        : [],
    ),
  );
  const hasCard = !!current && change.entityType !== "AI";
  const hasBattlefield = [current, proposed].some(
    (entry) => entry && battlefieldSceneOf(change.entityType, change.entityId, entry),
  );
  const questScenes: { label: string; objectiveIndex?: number }[] =
    change.entityType === "QUEST"
      ? [
          { label: "Quest scene" },
          ...(
            (proposed.content as { objectives?: unknown[] } | undefined)?.objectives ??
            []
          ).map((_, objectiveIndex) => ({
            label: `Objective ${objectiveIndex + 1}`,
            objectiveIndex,
          })),
        ]
      : [];
  const activeQuestScene =
    questScenes.find((scene) => scene.label === questSceneLabel) ?? questScenes[0];
  const questScene =
    fields && activeQuestScene
      ? questSceneOf(
          fields,
          {
            ...assets,
            ...Object.fromEntries(
              change.media.flatMap((media) =>
                media.kind === "IMAGE" && isSceneCharacterPath(media.path) && media.url
                  ? [[mediaPlaceholder(media.id), { image: media.url }]]
                  : [],
              ),
            ),
          },
          activeQuestScene.objectiveIndex,
        )
      : null;
  if (!hasCard && !hasBattlefield && questScenes.length === 0) return null;
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
              onClick={() => onModeChange(entry)}
            >
              {entry === "current" ? "Current" : "Proposed"}
            </button>
          ))}
        </div>
      </div>
      {hasCard && fields && (
        <ItemWithEffects
          item={fields as Parameters<typeof ItemWithEffects>[0]["item"]}
          hideDates
        />
      )}
      {activeQuestScene && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-bold text-xs opacity-70">Quest scene</h4>
            {questScenes.length > 1 && (
              <Select value={activeQuestScene.label} onValueChange={setQuestSceneLabel}>
                <SelectTrigger className="h-8 w-auto" aria-label="Scene to preview">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {questScenes.map(({ label }) => (
                    <SelectItem key={label} value={label}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {questScenes.length === 1 &&
              activeQuestScene.objectiveIndex !== undefined && (
                <span className="text-xs opacity-70">{activeQuestScene.label}</span>
              )}
          </div>
          {questScene ? (
            <>
              <div className="overflow-hidden rounded-lg border">
                <QuestDialogScene
                  background={questScene.background}
                  characters={questScene.characters}
                  description={questScene.description}
                />
              </div>
              {questScene.missing.length > 0 && (
                <p className="text-xs opacity-70">
                  Scene assets unavailable: {questScene.missing.join(", ")}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs opacity-70">It does not exist yet.</p>
          )}
        </div>
      )}
      {hasBattlefield && (
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

/** Entries the suggestion was written against, with a warning on any that changed since. */
const BasisList: React.FC<{ basis: Proposal["basis"] }> = ({ basis }) => (
  <section>
    <h3 className="mb-1 font-bold text-xs uppercase tracking-wide opacity-70">
      Based on
    </h3>
    <ul className="flex flex-col gap-1 text-xs">
      {basis.map((entry) => (
        <li
          key={`${entry.entityType}-${entry.entityId}`}
          className="flex items-center gap-2"
        >
          {entry.fresh ? (
            <CircleCheck className="h-4 w-4 text-green-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          )}
          <span>
            {entry.label} {entry.name}
            <span className="opacity-60">
              {" "}
              · {entry.role.toLowerCase()} · v {entry.version}
            </span>
          </span>
        </li>
      ))}
    </ul>
  </section>
);

/** Reason and optional note for a rejection; the next audit reads both. */
const RejectForm: React.FC<{
  reason: ContentProposalRejectReason;
  note: string;
  isSubmitting: boolean;
  onReasonChange: (reason: ContentProposalRejectReason) => void;
  onNoteChange: (note: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}> = ({
  reason,
  note,
  isSubmitting,
  onReasonChange,
  onNoteChange,
  onCancel,
  onSubmit,
}) => (
  <div className="flex w-full flex-col gap-2 rounded-lg border bg-poppopover p-2">
    <Label htmlFor="reject-reason">
      Why reject? The next audit reads this. Pick a reason (keys 1 to{" "}
      {ContentProposalRejectReasons.length}), then press Enter.
    </Label>
    <Select
      value={reason}
      onValueChange={(value) => onReasonChange(value as ContentProposalRejectReason)}
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
      maxLength={CONTENT_PROPOSAL_NOTE_MAX_LENGTH}
      placeholder="Optional note for the audit and the author"
      onChange={(e) => onNoteChange(e.target.value)}
    />
    <div className="flex justify-end gap-2">
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button variant="destructive" onClick={onSubmit} loading={isSubmitting}>
        Reject suggestion
      </Button>
    </div>
  </div>
);

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

/** Shortcut hint inside a button, shown from the md breakpoint up. */
const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="ml-2 hidden rounded border border-current/40 px-1 text-[10px] opacity-70 md:inline">
    {children}
  </kbd>
);

/** `changeId|field`: one change's field or media path in the reviewer's choices. */
const fieldKey = (change: Change, field: string) => `${change.id}|${field}`;

/**
 * Candidate a media path shows as picked: the reviewer's pick, else the one an approval used,
 * else the first, which approving applies by default.
 */
const chosenMedia = (
  change: Change,
  path: string,
  mediaChoice: ReviewChoices["mediaChoice"],
) => {
  const candidates = change.media.filter((media) => media.path === path);
  return (
    candidates.find((media) => media.id === mediaChoice[fieldKey(change, path)]) ??
    candidates.find((media) => media.chosen) ??
    candidates[0]
  );
};

/** Proposed top-level values after the reviewer's edits, exclusions and media picks. */
const proposedFields = (change: Change, choices: ReviewChoices) => {
  let fields: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(change.applied ?? change.after)) {
    const key = fieldKey(change, field);
    if (choices.excluded.has(key)) continue;
    fields[field] = choices.edits[key] ?? value;
  }
  for (const path of new Set(change.media.map((media) => media.path))) {
    const field = topLevelField(path);
    const pick = chosenMedia(change, path, choices.mediaChoice);
    if (!(field in fields) || !pick) continue;
    // A sound outside the catalog stays a placeholder that names the chosen candidate, so the
    // battlefield can play it from that candidate's URL.
    const value =
      pick.kind === "IMAGE" && !isSceneCharacterPath(path)
        ? pick.url
        : pick.source === "CATALOG"
          ? pick.externalId
          : pick.kind === "SFX" || isSceneCharacterPath(path)
            ? mediaPlaceholder(pick.id)
            : null;
    if (value) fields = setAtPath(fields, path, value);
  }
  return fields;
};

/**
 * Value libs/contentReview/submit.ts writes into a media field whose candidate is not in the
 * catalog yet.
 */
const mediaPlaceholder = (mediaId: string) => `media:${mediaId}`;

/** Whether a value is shown whole rather than as a list of changed leaves. */
const isScalar = (value: unknown) => value === null || typeof value !== "object";

/** Display text for one value: a dash when empty, JSON for objects. */
const formatScalar = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** A suggestion as the desk shows it. */
type Proposal = NonNullable<RouterOutputs["contentReview"]["getProposal"]>;
/** One entity a suggestion creates or updates. */
type Change = Proposal["changes"][number];
/** A candidate sound, animation or image for one media field of a change. */
type Media = Change["media"][number];
/** A catalog asset a media comparison shows. */
type Asset = Proposal["assets"][string];
/** Which version the in-game preview shows. */
type PreviewMode = "current" | "proposed";

/** How the reviewer adjusts a suggestion before approving it, each keyed by `fieldKey`. */
type ReviewChoices = {
  /** Fields left out of the approval. */
  excluded: Set<string>;
  /** Rewritten text per field. */
  edits: Record<string, string>;
  /** Picked candidate id per media path. */
  mediaChoice: Record<string, string>;
};

/** Candidate label prefix, as in "SFX proposal 2". */
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
