"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSaveSplash } from "@/hooks/useSplash";
import ContentBox from "@/layout/ContentBox";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { SuggestChange } from "@/layout/SuggestChange";
import { WelcomeBoard } from "@/layout/WelcomeBoard";
import { SPLASH_ID } from "@/libs/splash";
import { canChangeContent } from "@/utils/permissions";
import { useRequiredUserData } from "@/utils/UserContext";
import { type SplashContent, splashSchema } from "@/validators/splash";

export default function SplashEditorPage() {
  const { data: user } = useRequiredUserData();
  const allowed = canChangeContent(user?.role ?? "USER");
  const query = api.splash.getForEdit.useQuery(undefined, { enabled: allowed });
  if (!allowed) return <p>Only content staff can edit the welcome board.</p>;
  if (query.isPending) return <Loader explanation="Loading welcome board" />;
  if (query.isError)
    return (
      <p role="alert">
        Could not load the welcome board.{" "}
        <Button onClick={() => void query.refetch()}>Retry</Button>
      </p>
    );
  return (
    <ContentBox
      title="Welcome board"
      subtitle="Announcements and daily rewards in one login dialog"
    >
      <SplashEditor initial={query.data} />
    </ContentBox>
  );
}

function SplashEditor({ initial }: { initial: SplashContent }) {
  const [message, setMessage] = useState<string>();
  const form = useForm<SplashContent>({
    defaultValues: initial,
    resolver: zodResolver(splashSchema),
  });
  const cards = useFieldArray({ control: form.control, name: "cards" });
  const values = useWatch({ control: form.control });
  const preview = splashSchema.safeParse(values);
  const save = useSaveSplash({
    onSuccess: (result) => setMessage(result.message),
    onError: (error) => setMessage(error.message),
  });
  const errors = form.formState.errors;
  return (
    <div className="space-y-5">
      <p className="text-sm">
        Edit the illustrated cards, artwork and publication window. Players see this
        board with their daily claim.{" "}
        <Link className="underline" href="/manual/review">
          Review proposed updates
        </Link>
        .
      </p>
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit((data) => {
          setMessage(undefined);
          save.mutate({ id: SPLASH_ID, data });
        })}
      >
        <fieldset disabled={save.isPending} className="space-y-4">
          <div>
            <Label htmlFor="splash-name">Heading</Label>
            <Input id="splash-name" {...form.register("name")} maxLength={100} />
          </div>
          <div>
            <Label htmlFor="splash-description">Introduction</Label>
            <Textarea
              id="splash-description"
              {...form.register("description")}
              maxLength={300}
            />
          </div>
          <div>
            <Label htmlFor="splash-image">Banner image URL (optional, HTTPS)</Label>
            <Input id="splash-image" {...form.register("image")} />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" {...form.register("enabled")} /> Show announcements
            in the daily welcome dialog
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["startsAt", "endsAt"] as const).map((field) => (
              <div key={field}>
                <Label htmlFor={`splash-${field}`}>
                  {field === "startsAt" ? "Start" : "End"} (UTC, optional)
                </Label>
                <Controller
                  control={form.control}
                  name={field}
                  render={({ field: input }) => (
                    <Input
                      id={`splash-${field}`}
                      type="datetime-local"
                      ref={input.ref}
                      name={input.name}
                      onBlur={input.onBlur}
                      value={input.value?.slice(0, 16) ?? ""}
                      onChange={(event) =>
                        input.onChange(
                          event.target.value ? `${event.target.value}:00.000Z` : null,
                        )
                      }
                    />
                  )}
                />
              </div>
            ))}
          </div>
          {cards.fields.map((card, index) => (
            <fieldset key={card.id} className="space-y-3 rounded border p-3">
              <legend className="px-1 font-semibold">Announcement {index + 1}</legend>
              {(["title", "body", "image", "href", "linkLabel"] as const).map(
                (field) => (
                  <div key={field}>
                    <Label htmlFor={`card-${index}-${field}`}>
                      {
                        {
                          title: "Title",
                          body: "Text",
                          image: "Image URL (optional, HTTPS)",
                          href: "Game path (e.g. /points)",
                          linkLabel: "Link text",
                        }[field]
                      }
                    </Label>
                    {field === "body" ? (
                      <Textarea
                        id={`card-${index}-${field}`}
                        {...form.register(`cards.${index}.${field}`)}
                      />
                    ) : (
                      <Input
                        id={`card-${index}-${field}`}
                        {...form.register(`cards.${index}.${field}`)}
                      />
                    )}
                    {errors.cards?.[index]?.[field]?.message && (
                      <p className="text-destructive text-sm" role="alert">
                        {errors.cards[index]?.[field]?.message}
                      </p>
                    )}
                  </div>
                ),
              )}
              <Button
                type="button"
                variant="outline"
                disabled={cards.fields.length <= 1}
                onClick={() => cards.remove(index)}
              >
                Remove announcement
              </Button>
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={cards.fields.length >= 6}
              onClick={() =>
                cards.append({
                  title: "",
                  body: "",
                  image: "",
                  href: "/profile",
                  linkLabel: "Learn more",
                })
              }
            >
              Add announcement
            </Button>
            <Button type="submit">
              {save.isPending ? "Saving…" : "Save welcome board"}
            </Button>
            <SuggestChange
              entityType="SPLASH"
              entityId={SPLASH_ID}
              getData={() => {
                const parsed = splashSchema.safeParse(form.getValues());
                return parsed.success ? parsed.data : null;
              }}
            />
          </div>
        </fieldset>
        {Object.keys(errors).length > 0 && (
          <p role="alert" className="text-destructive">
            {errors.endsAt?.message ??
              errors.name?.message ??
              errors.image?.message ??
              "Check the highlighted announcement fields."}
          </p>
        )}
        {message && <p role="status">{message}</p>}
      </form>
      <h2 className="text-xl font-bold">Preview</h2>
      {preview.success ? (
        <WelcomeBoard content={preview.data} />
      ) : (
        <p>Complete the fields to preview this edition.</p>
      )}
    </div>
  );
}
