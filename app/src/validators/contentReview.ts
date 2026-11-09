import { z } from "zod";
import {
  COMBAT_BIOMES,
  CONTENT_PROPOSAL_MAX_BASIS,
  CONTENT_PROPOSAL_RATIONALE_LENGTH,
  CONTENT_PROPOSAL_RETENTION_DAYS,
  CONTENT_PROPOSAL_TITLE_LENGTH,
  ContentAuditFocuses,
  ContentProposalCategories,
  ContentProposalEntityTypes,
  ContentProposalMediaKinds,
  ContentProposalOperations,
  ContentProposalSources,
} from "@/drizzle/constants";

/**
 * One field assignment. `path` is a top-level editable field ("description") or a dotted
 * path into it ("effects.0.power"); `valueJson` is the new value encoded as JSON, which keeps
 * the audit's output schema expressible in strict structured-output mode.
 */
const proposalSetSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(191)
    .regex(/^[A-Za-z][A-Za-z0-9_]*(\.(\d+|[A-Za-z_][A-Za-z0-9_]*))*$/),
  valueJson: z.string().max(60_000),
});

/** Ask the server for sound, animation or image candidates for one field. */
const proposalMediaRequestSchema = z.object({
  kind: z.enum(ContentProposalMediaKinds),
  path: z.string().min(1).max(191),
  catalogIds: z.array(z.string().min(1).max(191)).max(3),
  search: z.string().min(3).max(120).nullable(),
  generate: z.string().min(3).max(400).nullable(),
});

/** One entity a suggestion changes. An UPDATE names it by `entityId`; a CREATE has none. */
const proposalChangeSchema = z.object({
  entityType: z.enum(ContentProposalEntityTypes),
  entityId: z.string().min(1).max(191).nullable(),
  operation: z.enum(ContentProposalOperations),
  // A new entity may set every editable field, and an item has over 70 of them.
  set: z.array(proposalSetSchema).max(100),
  media: z.array(proposalMediaRequestSchema).max(3),
});

/**
 * An entity a suggestion rests on, with the version `v` the snapshot showed. Every updated
 * entity must be listed, and a version that no longer matches refuses the suggestion.
 */
const proposalBasisSchema = z.object({
  entityType: z.enum(ContentProposalEntityTypes),
  entityId: z.string().min(1).max(191),
  v: z.string().length(16),
});

/** One suggestion of the content audit: up to four changes a reviewer decides on together. */
const agentProposalSchema = z.object({
  title: z
    .string()
    .min(CONTENT_PROPOSAL_TITLE_LENGTH.min)
    .max(CONTENT_PROPOSAL_TITLE_LENGTH.max),
  category: z.enum(ContentProposalCategories),
  rationale: z
    .string()
    .min(CONTENT_PROPOSAL_RATIONALE_LENGTH.min)
    .max(CONTENT_PROPOSAL_RATIONALE_LENGTH.max),
  confidence: z.number().int().min(0).max(100).nullable(),
  /** Rests on usage statistics, which go stale after CONTENT_PROPOSAL_EVIDENCE_DAYS. */
  usesUsageData: z.boolean(),
  changes: z.array(proposalChangeSchema).min(1).max(4),
  basis: z.array(proposalBasisSchema).max(CONTENT_PROPOSAL_MAX_BASIS),
});
export type AgentProposal = z.infer<typeof agentProposalSchema>;

/** The shape the audit model must return. */
export const agentAuditOutputSchema = z.object({
  proposals: z.array(agentProposalSchema),
});

/** What the audit's submit step posts: the model output plus run metadata. */
export const agentSubmissionSchema = agentAuditOutputSchema.extend({
  agentName: z.string().min(1).max(191),
  runUrl: z.url().max(512).nullish(),
  focus: z.enum(ContentAuditFocuses).nullish(),
});
export type AgentSubmission = z.infer<typeof agentSubmissionSchema>;

/** Full replacement of an agent draft, guarded by the revision returned by GET. */
export const agentProposalRevisionSchema = z.object({
  expectedStatusChangedAt: z.iso.datetime(),
  reactivate: z.boolean(),
  feedbackResponse: z.string().trim().min(20).max(2000).nullable(),
  proposal: agentProposalSchema,
  retainMediaIds: z.array(z.string().min(1).max(191)).max(12).optional(),
  runUrl: z.url().max(512).nullish(),
  focus: z.enum(ContentAuditFocuses).nullish(),
});
export type AgentProposalRevision = z.infer<typeof agentProposalRevisionSchema>;

/**
 * The audit's second look at its own suggestions, made from their battlefield renders: which
 * suggestions to keep, and which candidate assets looked wrong on the battlefield.
 */
export const visualCheckSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().min(0),
      keep: z.boolean(),
      rejectedAssetIds: z.array(z.string().min(1).max(191)).max(3),
      reason: z.string().min(3).max(600),
    }),
  ),
});

/** Content entity versions for the battlefield capture page to draw onto labelled sheets. */
export const battlefieldSheetsSchema = z.object({
  requests: z.array(
    z.object({
      title: z.string().min(1).max(200),
      entityType: z.enum(ContentProposalEntityTypes),
      entityId: z.string().min(1).max(191).nullable(),
      variants: z
        .array(
          z.object({
            name: z.string().min(1).max(160),
            fields: z.record(z.string(), z.unknown()),
          }),
        )
        .min(1)
        .max(4),
    }),
  ),
  perSheet: z.number().int().min(1).max(8),
  background: z.enum(COMBAT_BIOMES).prefault("ground"),
});
export type BattlefieldSheetsInput = z.infer<typeof battlefieldSheetsSchema>;

/** Query of the audit snapshot route; `rotate` takes the next focus in turn. */
export const auditSnapshotQuerySchema = z.object({
  focus: z.enum([...ContentAuditFocuses, "rotate"]).prefault("rotate"),
});

/**
 * A staff suggestion from a manual editor: `data` is the whole form, and a null `entityId`
 * drafts new content.
 */
export const staffCreateProposalSchema = z.object({
  entityType: z.enum(ContentProposalEntityTypes),
  entityId: z.string().min(1).max(191).nullable(),
  category: z.enum(ContentProposalCategories),
  title: z
    .string()
    .min(CONTENT_PROPOSAL_TITLE_LENGTH.min)
    .max(CONTENT_PROPOSAL_TITLE_LENGTH.max),
  rationale: z
    .string()
    .min(CONTENT_PROPOSAL_RATIONALE_LENGTH.min)
    .max(CONTENT_PROPOSAL_RATIONALE_LENGTH.max),
  data: z.record(z.string(), z.unknown()),
});
export type StaffCreateProposal = z.infer<typeof staffCreateProposalSchema>;

/**
 * Rejected and outdated rows only live for the retention window, so stats cannot go
 * further back.
 */
export const reviewStatsSchema = z.object({
  days: z
    .number()
    .int()
    .min(1)
    .max(CONTENT_PROPOSAL_RETENTION_DAYS)
    .prefault(CONTENT_PROPOSAL_RETENTION_DAYS),
  interval: z.enum(["daily", "weekly", "monthly"]).prefault("weekly"),
  category: z.enum(ContentProposalCategories).nullish(),
  entityType: z.enum(ContentProposalEntityTypes).nullish(),
  source: z.enum(ContentProposalSources).nullish(),
  agentName: z.string().max(191).nullish(),
});
export type ReviewStatsInput = z.infer<typeof reviewStatsSchema>;

export const sfxPreviewSchema = z.object({ epidemicId: z.string().min(1).max(191) });
