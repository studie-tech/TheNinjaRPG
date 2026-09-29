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
  ContentProposalCategories,
  type ContentProposalCategory,
  type ContentProposalEntityType,
} from "@/drizzle/constants";
import Modal from "@/layout/Modal";
import { CATEGORY_LABELS } from "@/libs/contentReview/labels";
import { showMutationToast } from "@/libs/toast";

interface SuggestChangeProps {
  entityType: ContentProposalEntityType;
  entityId: string;
  /**
   * The editor's current values, or null while the form does not validate. Only fields that
   * differ from the live row become the suggestion.
   */
  getData: () => Record<string, unknown> | null;
  /** Editors see this as a secondary option next to saving directly. */
  label?: string;
}

/**
 * Sends the editor's current values to the content review desk instead of saving them.
 * Staff who cannot edit content use it in place of "Save to Database".
 */
export const SuggestChange: React.FC<SuggestChangeProps> = (props) => {
  const { entityType, entityId, getData, label = "Suggest a change" } = props;
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
    onError: (err) => setError(err.message),
  });

  const isValid = title.trim().length >= 3 && rationale.trim().length >= 10;

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
        isValid={isValid}
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
              maxLength={120}
              placeholder="Fix the typo in the description"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="suggest-rationale">Why (required)</Label>
            <Textarea
              id="suggest-rationale"
              value={rationale}
              maxLength={4000}
              placeholder="What is wrong today, and why this change fixes it"
              onChange={(e) => setRationale(e.target.value)}
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>
      </Modal>
    </>
  );
};

export default SuggestChange;
