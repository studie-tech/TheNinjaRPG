import type {
  ContentProposalCategory,
  ContentProposalEntityType,
  ContentProposalRejectReason,
  ContentProposalStatus,
} from "@/drizzle/constants";

/** Display names shared by the review desk, the suggest dialog and server messages. */
export const ENTITY_LABELS: Record<ContentProposalEntityType, string> = {
  JUTSU: "Jutsu",
  ITEM: "Item",
  BLOODLINE: "Bloodline",
  QUEST: "Quest",
  BADGE: "Badge",
  GAME_ASSET: "Asset",
  AI: "AI",
};

export const CATEGORY_LABELS: Record<ContentProposalCategory, string> = {
  GRAMMAR: "Grammar",
  BALANCE: "Balance",
  SOUND: "Sound",
  ANIMATION: "Animation",
  VISUAL: "Visual",
  CONSISTENCY: "Consistency",
  NEW_CONTENT: "New content",
};

export const STATUS_LABELS: Record<ContentProposalStatus, string> = {
  PENDING: "Pending",
  APPLIED: "Applied",
  REJECTED: "Rejected",
  OUTDATED: "Outdated",
  REVERTED: "Reverted",
};

export const REJECT_REASON_LABELS: Record<ContentProposalRejectReason, string> = {
  NOT_AN_IMPROVEMENT: "Not an improvement",
  FACTUALLY_WRONG: "Factually wrong",
  STYLE_MISMATCH: "Doesn't fit the game's style",
  WRONG_CHANGE: "Right idea, wrong change",
  OTHER: "Other",
};
