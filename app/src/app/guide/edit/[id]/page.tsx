"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { GuideArticle } from "@/drizzle/schema";
import { useGuideEditForm } from "@/hooks/guide";
import Confirm2 from "@/layout/Confirm2";
import ContentBox from "@/layout/ContentBox";
import { EditContent } from "@/layout/EditContent";
import Loader from "@/layout/Loader";
import { withGuideHeadingIds } from "@/libs/guide/html";
import { showMutationToast } from "@/libs/toast";
import { parseHtml } from "@/utils/parse";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import { GuideArticleValidator, type ZodGuideArticleType } from "@/validators/guide";

export default function GuideEdit(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const guideId = params.id;
  const router = useRouter();
  const { data: userData } = useRequiredUserData();

  const { data, isPending, refetch } = api.guide.get.useQuery(
    { id: guideId },
    { enabled: !!guideId && !!userData },
  );

  useEffect(() => {
    if (userData && !canChangeContent(userData.role)) {
      void router.push("/profile");
    }
  }, [userData, router]);

  if (isPending || !userData || !canChangeContent(userData.role) || !data) {
    return <Loader explanation="Loading data" />;
  }

  return <SingleEditGuide article={data} refetch={refetch} />;
}

const SingleEditGuide: React.FC<{
  article: GuideArticle;
  refetch: () => void;
}> = ({ article, refetch }) => {
  const router = useRouter();
  const { form, formData, handleGuideSubmit } = useGuideEditForm(article, refetch);
  const content = useWatch({ control: form.control, name: "content" }) ?? "";
  const faq = useWatch({ control: form.control, name: "faq" }) ?? [];
  const title = useWatch({ control: form.control, name: "title" }) ?? article.title;

  const { mutate: remove, isPending } = api.guide.delete.useMutation({
    onSuccess: (data) => {
      showMutationToast(data);
      if (data.success) {
        router.push("/guide");
      }
    },
  });

  return (
    <ContentBox
      title="Content Panel"
      subtitle={`Guide: ${title}`}
      defaultBackHref="/guide"
      topRightContent={
        <Confirm2
          title="Delete Guide"
          button={
            <Button variant="destructive" size="sm" disabled={isPending}>
              <Trash2 className="mr-1 h-4 w-4" />
              Delete
            </Button>
          }
          onAccept={() => remove({ id: article.id })}
        >
          <p>Delete this guide article? This cannot be undone.</p>
        </Confirm2>
      }
    >
      <Tabs defaultValue="edit">
        <TabsList>
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="edit" className="mt-4">
          <EditContent
            schema={GuideArticleValidator}
            form={form as unknown as UseFormReturn<ZodGuideArticleType>}
            formData={formData}
            showSubmit={true}
            buttonTxt="Save to Database"
            type="guide"
            relationId={article.id}
            allowImageUpload={true}
            onAccept={handleGuideSubmit}
          />
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-bold">FAQ</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  form.setValue("faq", [...faq, { question: "", answer: "" }], {
                    shouldDirty: true,
                  })
                }
              >
                <Plus className="mr-1 h-4 w-4" />
                Add question
              </Button>
            </div>
            {faq.map((item, index) => (
              <div key={`faq-${index}`} className="grid gap-2 rounded-md border p-3">
                <Input
                  value={item.question}
                  placeholder="Question"
                  onChange={(event) => {
                    const next = [...faq];
                    next[index] = { ...item, question: event.target.value };
                    form.setValue("faq", next, { shouldDirty: true });
                  }}
                />
                <Textarea
                  value={item.answer}
                  placeholder="Answer"
                  rows={3}
                  onChange={(event) => {
                    const next = [...faq];
                    next[index] = { ...item, answer: event.target.value };
                    form.setValue("faq", next, { shouldDirty: true });
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    form.setValue(
                      "faq",
                      faq.filter((_, faqIndex) => faqIndex !== index),
                      { shouldDirty: true },
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="preview" className="mt-4">
          <article className="space-y-3 [&_a]:font-bold [&_a]:text-orange-500 [&_h2]:mt-5 [&_h2]:font-bold [&_h2]:text-xl [&_h3]:mt-4 [&_h3]:font-semibold [&_ul]:ml-5 [&_ul]:list-disc">
            {parseHtml(withGuideHeadingIds(content))}
          </article>
        </TabsContent>
      </Tabs>
    </ContentBox>
  );
};
