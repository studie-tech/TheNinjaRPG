import type {
  ContentProposalCategory,
  ContentProposalEntityType,
  ContentProposalRejectReason,
  ContentProposalSource,
  ContentProposalStatus,
} from "@/drizzle/constants";

/** Group audit variants by agent keyword; staff submissions always remain Staff. */
export const reviewStatsSourceLabel = (
  source: ContentProposalSource,
  agentName: string | null,
): "Codex" | "Claude" | "Staff" => {
  if (source === "STAFF") return "Staff";
  if (/codex/i.test(agentName ?? "")) return "Codex";
  if (/claude/i.test(agentName ?? "")) return "Claude";
  return "Staff";
};

/** Display name of each content type, in server messages and on the review desk. */
export const ENTITY_LABELS: Record<ContentProposalEntityType, string> = {
  JUTSU: "Jutsu",
  ITEM: "Item",
  BLOODLINE: "Bloodline",
  QUEST: "Quest",
  BADGE: "Badge",
  GAME_ASSET: "Asset",
  AI: "AI",
};

/** Display name of each suggestion category, on the review desk and the suggest dialog. */
export const CATEGORY_LABELS: Record<ContentProposalCategory, string> = {
  GRAMMAR: "Grammar",
  BALANCE: "Balance",
  SOUND: "Sound",
  ANIMATION: "Animation",
  VISUAL: "Visual",
  CONSISTENCY: "Consistency",
  NEW_CONTENT: "New content",
};

/** Display name of each suggestion status. */
export const STATUS_LABELS: Record<ContentProposalStatus, string> = {
  PENDING: "Pending",
  APPLIED: "Applied",
  REJECTED: "Rejected",
  OUTDATED: "Outdated",
  REVERTED: "Reverted",
};

/** Reasons a reviewer can give for rejecting a suggestion, as the review desk offers them. */
export const REJECT_REASON_LABELS: Record<ContentProposalRejectReason, string> = {
  NOT_AN_IMPROVEMENT: "Not an improvement",
  FACTUALLY_WRONG: "Factually wrong",
  STYLE_MISMATCH: "Doesn't fit the game's style",
  WRONG_CHANGE: "Right idea, wrong change",
  OTHER: "Other",
};
