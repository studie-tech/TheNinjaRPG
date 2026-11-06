"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useSingleFlight } from "@/hooks/useSingleFlight";
import ContentBox from "@/layout/ContentBox";
import Modal from "@/layout/Modal";
import RichInput from "@/layout/RichInput";
import { parseHtml } from "@/utils/parse";
import type { MutateContentSchema } from "@/validators/comments";
import { mutateContentSchema } from "@/validators/comments";

/**
 * Message board of a group with an editor for its leaders. Callers own the mutation and
 * its feedback, so cards on the same page keep separate pending states.
 */
export const GroupOrders: React.FC<GroupOrdersProps> = (props) => {
  const {
    content,
    draft = content,
    dialogTitle = "Update Orders",
    inputLabel = "Contents of your orders",
    isPending,
  } = props;
  const [isOpen, setIsOpen] = useState(false);
  const submission = useSingleFlight();

  const {
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<MutateContentSchema>({
    defaultValues: { content: draft },
    resolver: zodResolver(mutateContentSchema),
  });
  const onUpdate = handleSubmit((data) =>
    submission.run(true, async () => {
      try {
        const result = await props.onSubmit(data);
        if (!result.success) return;
        reset(data);
        setIsOpen(false);
      } catch {
        // The mutation reports the failure; the draft stays open for a retry.
      }
    }),
  );

  return (
    <ContentBox
      title={props.title}
      subtitle={props.subtitle}
      initialBreak={true}
      topRightContent={
        props.canPost && (
          <div className="flex flex-row items-center gap-1">
            {props.renderTrigger(() => setIsOpen(true))}
            <Modal
              id={props.dialogId}
              title={dialogTitle}
              isOpen={isOpen}
              setIsOpen={setIsOpen}
              proceed_label="Submit"
              proceed_loading_label="Updating"
              isLoading={isPending}
              keepOpenOnAccept
              onAccept={() => void onUpdate()}
            >
              <RichInput
                id="content"
                label={inputLabel}
                height="300"
                placeholder={content}
                control={control}
                error={errors.content?.message}
                disabled={isPending}
              />
            </Modal>
          </div>
        )
      }
    >
      {parseHtml(content)}
      {props.children}
    </ContentBox>
  );
};

interface GroupOrdersProps {
  title: string;
  subtitle: string;
  /** Displayed text, and the editor's placeholder. */
  content: string;
  /** Text the editor starts from, when it differs from the displayed fallback. */
  draft?: string;
  canPost: boolean;
  dialogId?: string;
  dialogTitle?: string;
  inputLabel?: string;
  isPending: boolean;
  /** Sends the draft; it stays in the open dialog unless the response succeeds. */
  onSubmit: (data: MutateContentSchema) => Promise<{ success: boolean }>;
  /** The button that opens the editor, which each group styles itself. */
  renderTrigger: (open: () => void) => React.ReactNode;
  children?: React.ReactNode;
}
