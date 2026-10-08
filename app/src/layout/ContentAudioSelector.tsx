"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import type React from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import Loader from "@/layout/Loader";
import { cn } from "@/libs/shadui";
import { showMutationToast } from "@/libs/toast";
import { generateAudioSchema } from "@/validators/audio";

interface ContentAudioSelectorProps {
  relationId: string;
  value?: string | null;
  onChange: (url: string) => void;
}

const ContentAudioSelector: React.FC<ContentAudioSelectorProps> = (props) => {
  const { relationId, value, onChange } = props;
  const utils = api.useUtils();
  const [isOpen, setIsOpen] = useState(false);
  const form = useForm<
    z.input<typeof generateAudioSchema>,
    unknown,
    z.output<typeof generateAudioSchema>
  >({
    resolver: zodResolver(generateAudioSchema),
    defaultValues: {
      relationId,
      prompt: "",
      negativePrompt: undefined,
      secondsTotal: 1,
    },
    mode: "onChange",
  });

  const gen = api.audio.generate.useMutation({
    onSuccess: async (res) => {
      showMutationToast(res);
      if (res.success && res.url) {
        onChange(res.url);
        await utils.audio.getHistorical.invalidate();
      }
    },
  });

  const {
    data: history,
    fetchNextPage,
    hasNextPage,
  } = api.audio.getHistorical.useInfiniteQuery(
    { relationId, limit: 20 },
    {
      getNextPageParam: (p) => p.nextCursor,
      placeholderData: (p) => p,
      enabled: isOpen,
    },
  );
  const items = history?.pages.flatMap((p) => p.data) || [];

  return (
    <div className="flex flex-col justify-start">
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          <div className="flex flex-col items-center gap-1">
            <Button variant="outline" className="h-10 w-full justify-between">
              Pick / Generate Sound
            </Button>
            <Label className="text-muted-foreground text-xs">Current Sound</Label>
          </div>
        </DialogTrigger>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Sound Effect</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-6">
            <div className="space-y-3">
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit((values) => {
                    gen.mutate({
                      relationId: values.relationId,
                      prompt: values.prompt.trim(),
                      negativePrompt: values.negativePrompt?.trim() || undefined,
                      secondsTotal: values.secondsTotal,
                    });
                  })}
                  className="space-y-3"
                >
                  <FormField
                    control={form.control}
                    name="prompt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prompt</FormLabel>
                        <FormControl>
                          <Textarea placeholder="Prompt" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="negativePrompt"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Negative prompt (optional)</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="Negative prompt (optional)"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="secondsTotal"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Duration (seconds)</FormLabel>
                        <div className="flex items-center gap-2">
                          <FormControl>
                            <Input
                              type="number"
                              min={1}
                              max={5}
                              step={1}
                              className="w-28"
                              value={field.value as number}
                              onChange={(e) =>
                                field.onChange(
                                  Number.isFinite(e.currentTarget.valueAsNumber)
                                    ? e.currentTarget.valueAsNumber
                                    : 1,
                                )
                              }
                            />
                          </FormControl>
                          <span className="text-muted-foreground text-sm">seconds</span>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={gen.isPending}>
                    {gen.isPending ? <Loader noPadding size={22} /> : "Generate"}
                  </Button>
                </form>
              </Form>
            </div>

            <div className="space-y-2">
              <div className="grid max-h-96 grid-cols-2 gap-3 overflow-auto md:grid-cols-3">
                {items.map((s) => {
                  const selected = value && s.url && value === s.url;
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        "space-y-2 rounded border p-2",
                        selected ? "border-green-500 bg-green-50" : "",
                      )}
                    >
                      {/* biome-ignore lint/a11y/useMediaCaption: Audio selector for content - no captions needed for music/sfx */}
                      <audio src={s.url ?? undefined} controls className="w-full" />
                      {s.prompt ? (
                        <div className="break-words text-muted-foreground text-xs">
                          {s.prompt}
                        </div>
                      ) : null}
                      {s.negativePrompt ? (
                        <div className="break-words text-[10px] text-muted-foreground">
                          − {s.negativePrompt}
                        </div>
                      ) : null}
                      <Button
                        variant={selected ? "default" : "secondary"}
                        className="w-full"
                        onClick={() => {
                          if (s.url) onChange(s.url);
                          setIsOpen(false);
                        }}
                      >
                        {selected ? "Selected" : "Use this"}
                      </Button>
                    </div>
                  );
                })}
              </div>
              {hasNextPage && (
                <Button variant="outline" onClick={() => fetchNextPage()}>
                  Load more
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ContentAudioSelector;
