import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import type { Badge } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import { useUserData } from "@/utils/UserContext";
import type { ZodBadgeType } from "@/validators/badge";
import { BadgeValidator } from "@/validators/badge";

/**
 * Hook used when creating frontend forms for editing badges
 * @param data
 */
export const useBadgeEditForm = (badge: Badge, refetch: () => void) => {
  const { userId } = useUserData();
  const [editorBadge, setEditorBadge] = useState<Badge>(() => copyBadge(badge));
  const [isUpdating, setIsUpdating] = useState(false);
  const inFlightRef = useRef<BadgeSubmission | null>(null);
  const retryRef = useRef<BadgeSubmission | null>(null);
  const mountedRef = useRef(true);
  const editorIdentity = `${userId ?? "unknown"}:${editorBadge.id}:${editorBadge.updatedAt.getTime()}`;
  const editorIdentityRef = useRef(editorIdentity);
  editorIdentityRef.current = editorIdentity;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      inFlightRef.current = null;
    };
  }, []);

  // Form handling
  const form = useForm<ZodBadgeType>({
    mode: "all",
    criteriaMode: "all",
    defaultValues: badge,
    resolver: zodResolver(BadgeValidator),
  });

  // Mutation for updating badges
  const utils = api.useUtils();
  const updateBadge = api.badge.update.useMutation();

  // Form submission
  const handleBadgeSubmit = form.handleSubmit(
    async (data: ZodBadgeType) => {
      // `isPending` cannot close a same-tick double click. Claim the exact submission in a ref
      // before awaiting anything, and retain it after an uncertain failure for an idempotent retry.
      if (inFlightRef.current) return;
      const submittedBadge = copyFormData(data);
      const diff = calculateContentDiff(editorBadge, {
        ...editorBadge,
        ...submittedBadge,
      });
      if (diff.length === 0) return;

      const previousRetry = retryRef.current;
      const submission =
        previousRetry &&
        previousRetry.identity === editorIdentity &&
        badgeFormDataMatch(previousRetry.data, submittedBadge)
          ? previousRetry
          : Object.freeze({
              identity: editorIdentity,
              requestId: crypto.randomUUID(),
              badgeId: editorBadge.id,
              expectedUpdatedAt: new Date(editorBadge.updatedAt),
              expectedBadge: copyBadge(editorBadge),
              data: submittedBadge,
            });

      inFlightRef.current = submission;
      retryRef.current = submission;
      setIsUpdating(true);
      try {
        const response = await updateBadge.mutateAsync({
          id: submission.badgeId,
          expectedUpdatedAt: submission.expectedUpdatedAt,
          expectedBadge: submission.expectedBadge,
          data: submission.data,
          requestId: submission.requestId,
        });
        if (
          !mountedRef.current ||
          inFlightRef.current !== submission ||
          editorIdentityRef.current !== submission.identity
        ) {
          return;
        }
        if (!response.success) {
          showMutationToast(response);
          return;
        }

        const committed = response.committedBadge;
        const verified =
          response.requestId === submission.requestId &&
          response.actorUserId === userId &&
          response.badgeId === submission.badgeId &&
          response.expectedUpdatedAt?.getTime() ===
            submission.expectedUpdatedAt.getTime() &&
          response.submittedBadge !== undefined &&
          badgeFormDataMatch(response.submittedBadge, submission.data) &&
          response.previousBadge !== undefined &&
          badgeDocumentsMatch(response.previousBadge, submission.expectedBadge) &&
          committed !== undefined &&
          committed.id === submission.badgeId &&
          committed.createdAt.getTime() ===
            submission.expectedBadge.createdAt.getTime() &&
          committed.updatedAt.getTime() >
            submission.expectedBadge.updatedAt.getTime() &&
          badgeFormDataMatch(committed, submission.data);
        if (!verified || !committed) {
          showMutationToast({
            success: false,
            message:
              "The server response could not be matched to this badge save. Your draft is still available; please retry.",
          });
          return;
        }

        // Install the exact committed document before any background fetch can surface an older
        // response. Resetting the draft is safe only after all request identity checks passed.
        const committedBadge = copyBadge(committed);
        retryRef.current = null;
        setEditorBadge(committedBadge);
        form.reset(copyFormData(committedBadge));
        utils.badge.get.setData({ id: submission.badgeId }, committedBadge);
        showMutationToast(response);
        await Promise.allSettled([
          refetch(),
          utils.badge.getAll.invalidate(),
          utils.badge.getAllNames.invalidate(),
        ]);
      } catch {
        // The shared tRPC error handler reports transport failures. Keep the exact draft,
        // original revision, and UUID so a retry can recover a lost success response safely.
      } finally {
        if (inFlightRef.current === submission) {
          inFlightRef.current = null;
          if (mountedRef.current) setIsUpdating(false);
        }
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  // Watch for changes to avatar
  const imageUrl = useWatch({
    control: form.control,
    name: "image",
  });

  // Object for form values
  const formData: FormEntry<keyof ZodBadgeType>[] = [
    { id: "name", label: "Badge Name", type: "text" },
    { id: "image", type: "avatar", href: imageUrl },
    { id: "description", type: "text" },
  ];

  return {
    badge: editorBadge,
    form,
    formData,
    handleBadgeSubmit,
    isUpdating,
  };
};

type BadgeSubmission = Readonly<{
  identity: string;
  requestId: string;
  badgeId: string;
  expectedUpdatedAt: Date;
  expectedBadge: Badge;
  data: ZodBadgeType;
}>;

const copyBadge = (badge: Badge): Badge =>
  Object.freeze({
    ...badge,
    createdAt: new Date(badge.createdAt),
    updatedAt: new Date(badge.updatedAt),
  });

const copyFormData = (data: ZodBadgeType): ZodBadgeType =>
  Object.freeze({
    name: data.name,
    image: data.image,
    description: data.description,
  });

const badgeFormDataMatch = (left: ZodBadgeType, right: ZodBadgeType) =>
  left.name === right.name &&
  left.image === right.image &&
  left.description === right.description;

const badgeDocumentsMatch = (left: Badge, right: Badge) =>
  left.id === right.id &&
  left.createdAt.getTime() === right.createdAt.getTime() &&
  left.updatedAt.getTime() === right.updatedAt.getTime() &&
  badgeFormDataMatch(left, right);
