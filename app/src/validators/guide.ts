import { z } from "zod";
import { GuideCategories } from "@/drizzle/constants";
import { isReservedGuideSlug } from "@/libs/guide/html";

export const GuideFaqItemSchema = z.object({
  question: z.string().trim().min(1).max(200),
  answer: z.string().trim().min(1).max(1000),
});
export type GuideFaqItem = z.infer<typeof GuideFaqItemSchema>;

export const GuideSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens")
  .refine((slug) => !isReservedGuideSlug(slug), {
    message: "That slug is reserved",
  });

export const GuideArticleValidator = z.object({
  slug: GuideSlugSchema,
  title: z.string().trim().min(1).max(191),
  subtitle: z.string().trim().max(255).optional().nullable(),
  excerpt: z.string().trim().max(500).optional().nullable(),
  seoTitle: z.string().trim().max(70).optional().nullable(),
  seoDescription: z.string().trim().max(160).optional().nullable(),
  category: z.enum(GuideCategories),
  content: z.string().min(1).max(200_000),
  image: z
    .union([z.url(), z.literal("")])
    .optional()
    .nullable(),
  faq: z.array(GuideFaqItemSchema).max(12).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).max(10_000),
  published: z.boolean(),
  relatedBloodlineId: z.string().max(191).optional().nullable(),
  relatedItemId: z.string().max(191).optional().nullable(),
  relatedJutsuId: z.string().max(191).optional().nullable(),
  sourceUrl: z
    .union([z.url(), z.literal("")])
    .optional()
    .nullable(),
  reviewNotes: z.string().trim().max(4000).optional().nullable(),
});

export type ZodGuideArticleType = z.infer<typeof GuideArticleValidator>;
export type ZodGuideArticleInput = z.input<typeof GuideArticleValidator>;

export const GuideListFilterSchema = z.object({
  category: z.enum(GuideCategories).optional(),
  search: z.string().trim().max(80).optional(),
  includeDrafts: z.boolean().optional(),
});
