import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { GuideCategories } from "@/drizzle/constants";
import type { GuideArticle } from "@/drizzle/schema";
import type { FormEntry } from "@/layout/EditContent";
import { showFormErrorsToast, showMutationToast } from "@/libs/toast";
import { calculateContentDiff } from "@/utils/diff";
import type { ZodGuideArticleInput, ZodGuideArticleType } from "@/validators/guide";
import { GuideArticleValidator } from "@/validators/guide";

const toFormValues = (article: GuideArticle): ZodGuideArticleInput => ({
  slug: article.slug,
  title: article.title,
  subtitle: article.subtitle ?? "",
  excerpt: article.excerpt ?? "",
  seoTitle: article.seoTitle ?? "",
  seoDescription: article.seoDescription ?? "",
  category: article.category,
  content: article.content,
  image: article.image ?? "",
  faq: article.faq ?? [],
  sortOrder: article.sortOrder,
  published: article.published,
  relatedBloodlineId: article.relatedBloodlineId ?? "",
  relatedItemId: article.relatedItemId ?? "",
  relatedJutsuId: article.relatedJutsuId ?? "",
  sourceUrl: article.sourceUrl ?? "",
  reviewNotes: article.reviewNotes ?? "",
});

export const useGuideEditForm = (article: GuideArticle, refetch: () => void) => {
  const form = useForm<ZodGuideArticleInput, unknown, ZodGuideArticleType>({
    mode: "all",
    criteriaMode: "all",
    values: toFormValues(article),
    defaultValues: toFormValues(article),
    resolver: zodResolver(GuideArticleValidator),
  });

  const { mutate: updateGuide, isPending } = api.guide.update.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      refetch();
    },
  });

  const handleGuideSubmit = form.handleSubmit(
    (data: ZodGuideArticleType) => {
      const next = {
        ...toFormValues(article),
        ...data,
        faq: (data.faq ?? []).filter(
          (item) => item.question.trim() && item.answer.trim(),
        ),
      };
      const diff = calculateContentDiff(toFormValues(article), next);
      if (diff.length > 0) {
        updateGuide({ id: article.id, data: next });
      }
    },
    (errors) => showFormErrorsToast(errors),
  );

  const imageUrl = useWatch({ control: form.control, name: "image" });
  const { data: bloodlines } = api.bloodline.getAllNames.useQuery(undefined);
  const { data: items } = api.item.getAllNames.useQuery(undefined);
  const { data: jutsus } = api.jutsu.getAllNames.useQuery(undefined);

  const formData: FormEntry<keyof ZodGuideArticleType>[] = [
    {
      id: "image",
      type: "avatar",
      href: imageUrl || null,
      size: "landscape",
      maxDim: 1280,
      doubleWidth: true,
    },
    { id: "title", label: "Title", type: "text" },
    { id: "slug", label: "Slug", type: "text" },
    { id: "subtitle", label: "Subtitle", type: "text" },
    {
      id: "category",
      label: "Category",
      type: "str_array",
      values: GuideCategories,
    },
    { id: "published", label: "Published", type: "boolean" },
    { id: "sortOrder", label: "Sort order", type: "number" },
    { id: "excerpt", label: "Excerpt", type: "textarea", rows: 3, doubleWidth: true },
    { id: "seoTitle", label: "SEO title", type: "text" },
    {
      id: "seoDescription",
      label: "SEO description",
      type: "textarea",
      rows: 2,
      doubleWidth: true,
    },
    {
      id: "relatedBloodlineId",
      label: "Related bloodline",
      type: "db_values",
      values: bloodlines,
      resetButton: true,
      searchable: true,
    },
    {
      id: "relatedItemId",
      label: "Related item",
      type: "db_values",
      values: items,
      resetButton: true,
      searchable: true,
    },
    {
      id: "relatedJutsuId",
      label: "Related jutsu",
      type: "db_values",
      values: jutsus,
      resetButton: true,
      searchable: true,
    },
    { id: "sourceUrl", label: "Source URL", type: "text", doubleWidth: true },
    {
      id: "reviewNotes",
      label: "Review notes (staff)",
      type: "textarea",
      rows: 5,
      doubleWidth: true,
    },
    {
      id: "content",
      label: "Article body (HTML)",
      type: "richinput",
      height: "420",
      doubleWidth: true,
    },
  ];

  return { article, form, formData, handleGuideSubmit, isPending };
};
