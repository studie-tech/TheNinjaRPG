"use client";

import { MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  CONTENT_PROPOSAL_RATIONALE_LENGTH,
  CONTENT_PROPOSAL_TITLE_LENGTH,
  ContentProposalCategories,
  type ContentProposalCategory,
  type ContentProposalEntityType,
} from "@/drizzle/constants";
import Modal from "@/layout/Modal";
import { CATEGORY_LABELS } from "@/libs/contentReview/labels";
import { showMutationToast } from "@/libs/toast";
import { formatTrpcErrorMessage } from "@/utils/error";
import { canSuggestContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";

interface SuggestChangeProps {
  entityType: ContentProposalEntityType;
  entityId: string;
  /**
   * The editor's current values, or null while the form does not validate. Only fields that
   * differ from the live row become the suggestion.
   */
  getData: () => Record<string, unknown> | null;
  /** Button text, such as "Suggest instead" beside a save button. */
  label?: string;
}

/** Hint under a field that is still shorter than the server accepts. */
const minLengthHint = (length: number, min: number) =>
  `At least ${min} characters (${length}/${min})`;

/**
 * Sends the editor's current values to the content review desk instead of saving them.
 * Only eligible staff see the controls; the server enforces the same permission at submission.
 */
export const SuggestChange: React.FC<SuggestChangeProps> = (props) => {
  const { entityType, entityId, getData, label = "Suggest a change" } = props;
  const { data: userData } = useRequiredUserData();
  const [category, setCategory] = useState<ContentProposalCategory>("CONSISTENCY");
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const { mutate, isPending } = api.contentReview.create.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        setTitle("");
        setRationale("");
        setError(null);
        setIsOpen(false);
      } else {
        setError(data.message);
      }
    },
    onError: (err) => setError(formatTrpcErrorMessage(err)),
  });

  const titleLength = title.trim().length;
  const rationaleLength = rationale.trim().length;
  const isValid =
    titleLength >= CONTENT_PROPOSAL_TITLE_LENGTH.min &&
    rationaleLength >= CONTENT_PROPOSAL_RATIONALE_LENGTH.min;

  // Keep hooks unconditional while user data loads or the staff role changes.
  if (!canSuggestContent(userData?.role)) return null;

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="gap-2"
        onClick={() => setIsOpen(true)}
      >
        <MessageSquarePlus className="h-5 w-5" />
        {label}
      </Button>
      <Modal
        title="Suggest a change"
        isOpen={isOpen}
        setIsOpen={setIsOpen}
        proceed_label="Send for review"
        proceed_loading_label="Sending..."
        proceedDisabled={!isValid}
        isLoading={isPending}
        keepOpenOnAccept={true}
        onAccept={(e) => {
          e.preventDefault();
          setError(null);
          const data = getData();
          if (!data) {
            setError("The editor has invalid fields. Fix them before suggesting.");
            return;
          }
          mutate({
            entityType,
            entityId,
            category,
            title: title.trim(),
            rationale: rationale.trim(),
            data,
          });
        }}
      >
        <div className="grid gap-3">
          <p className="text-sm">
            Your current edits go to the content review desk. A content editor sees
            exactly what you changed and why, and applies it or explains why not.
          </p>
          <div className="grid gap-1">
            <Label htmlFor="suggest-category">Category</Label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as ContentProposalCategory)}
            >
              <SelectTrigger id="suggest-category">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {ContentProposalCategories.filter(
                  (entry) => entry !== "NEW_CONTENT",
                ).map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {CATEGORY_LABELS[entry]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="suggest-title">Title</Label>
            <Input
              id="suggest-title"
              value={title}
              maxLength={CONTENT_PROPOSAL_TITLE_LENGTH.max}
              placeholder="Fix the typo in the description"
              onChange={(e) => setTitle(e.target.value)}
            />
            {titleLength < CONTENT_PROPOSAL_TITLE_LENGTH.min && (
              <p className="text-muted-foreground text-xs">
                {minLengthHint(titleLength, CONTENT_PROPOSAL_TITLE_LENGTH.min)}
              </p>
            )}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="suggest-rationale">Why (required)</Label>
            <Textarea
              id="suggest-rationale"
              value={rationale}
              maxLength={CONTENT_PROPOSAL_RATIONALE_LENGTH.max}
              placeholder="What is wrong today, and why this change fixes it"
              onChange={(e) => setRationale(e.target.value)}
            />
            {rationaleLength < CONTENT_PROPOSAL_RATIONALE_LENGTH.min && (
              <p className="text-muted-foreground text-xs">
                {minLengthHint(rationaleLength, CONTENT_PROPOSAL_RATIONALE_LENGTH.min)}
              </p>
            )}
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
      </Modal>
    </>
  );
};
