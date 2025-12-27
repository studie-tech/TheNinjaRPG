"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import ContentBox from "@/layout/ContentBox";
import ConceptImage from "@/layout/ConceptImage";
import Confirm2 from "@/layout/Confirm2";
import {
  Form,
  FormControl,
  FormLabel,
  FormField,
  FormItem,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { api } from "@/app/_trpc/client";
import {
  conceptArtPromptSchema,
  conceptArtFilterSchema,
  conceptVideoPromptSchema,
} from "@/validators/art";
import { sortOptions, timeFrame } from "@/validators/art";
import {
  User,
  Sparkles,
  Loader2,
  Video,
  ImageIcon,
  X,
  Upload,
  ImagePlus,
} from "lucide-react";
import { useUserData } from "@/utils/UserContext";
import { UploadDropzone } from "@/utils/uploadthing";
import Image from "next/image";
import { showMutationToast } from "@/libs/toast";
import { useInfinitePagination } from "@/libs/pagination";
import { COST_CONCEPT_IMAGE, COST_CONCEPT_VIDEO } from "@/drizzle/constants";
import type {
  ConceptPromptType,
  ConceptFilterType,
  ConceptVideoPromptType,
} from "@/validators/art";

export default function ConceptArt() {
  // State
  const [lastElement, setLastElement] = useState<HTMLDivElement | null>(null);
  const [creationType, setCreationType] = useState<"image" | "video">("image");
  const { data: userData } = useUserData();

  // Routing
  const router = useRouter();

  // tRPC Utility
  const utils = api.useUtils();

  // Form handling - filter
  const filterForm = useForm<ConceptFilterType>({
    defaultValues: conceptArtFilterSchema.parse({}),
    resolver: zodResolver(conceptArtFilterSchema),
  });

  // Form handling - image prompt
  const promptForm = useForm<ConceptPromptType>({
    defaultValues: conceptArtPromptSchema.parse({}),
    resolver: zodResolver(conceptArtPromptSchema),
  });

  // Form handling - video prompt
  const videoPromptForm = useForm<ConceptVideoPromptType>({
    defaultValues: {
      prompt: "",
      negative_prompt: "",
      seed: Math.floor(Math.random() * 1000000),
      start_image: "",
      last_image: "",
    },
    resolver: zodResolver(conceptVideoPromptSchema),
  });

  // Create a new image
  const { mutate: create, isPending: isImagePending } =
    api.conceptart.create.useMutation({
      onSuccess: async (result) => {
        showMutationToast(result);
        if (result.success && result.imageId) {
          promptForm.setValue("prompt", "");
          filterForm?.setValue("only_own", true);
          filterForm?.setValue("sort", "Most Recent");
          router.push(`/conceptart/${result.imageId}`);
          await utils.conceptart.getAll.refetch();
          await utils.profile.getUser.refetch();
        }
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  // Create a new video
  const { mutate: createVideo, isPending: isVideoPending } =
    api.conceptart.createVideo.useMutation({
      onSuccess: async (result) => {
        showMutationToast({
          success: result.success,
          message: result.success
            ? "Video generation started! You'll be redirected to see the progress."
            : result.message,
        });
        if (result.success && result.videoId) {
          videoPromptForm.reset();
          filterForm?.setValue("only_own", true);
          filterForm?.setValue("sort", "Most Recent");
          // Navigate to video page where polling will show progress
          router.push(`/conceptart/${result.videoId}`);
          await utils.conceptart.getAll.refetch();
          await utils.profile.getUser.refetch();
        }
      },
      onError: (error) => {
        showMutationToast({ success: false, message: error.message });
      },
    });

  const isPending = isImagePending || isVideoPending;

  // Filters
  const only_own = useWatch({ control: filterForm.control, name: "only_own" });
  const sort = useWatch({ control: filterForm.control, name: "sort" });
  const time_frame = useWatch({ control: filterForm.control, name: "time_frame" });

  // Fetch data
  const { data, fetchNextPage, hasNextPage } = api.conceptart.getAll.useInfiniteQuery(
    { only_own, sort, time_frame, limit: 50 },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      placeholderData: (previousData) => previousData,
    },
  );
  const allImage = data?.pages
    .map((page) => page.data)
    .flat()
    .sort((a, b) => {
      if (sort === "Most Recent") {
        return b.createdAt.getTime() - a.createdAt.getTime();
      } else if (sort === "Most Liked") {
        return b.sumReaction - a.sumReaction;
      }
      return 1;
    });
  useInfinitePagination({ fetchNextPage, hasNextPage, lastElement });

  // Handle image creation
  const handleCreateImage = promptForm.handleSubmit(
    (data) => {
      if (userData) {
        if (userData.reputationPoints >= COST_CONCEPT_IMAGE) {
          if (!isPending) create(data);
        } else {
          showMutationToast({ success: false, message: "No reputation points left." });
        }
      }
    },
    (errors) => console.log(errors),
  );

  // Handle video creation
  const handleCreateVideo = videoPromptForm.handleSubmit(
    (data) => {
      if (userData) {
        if (userData.reputationPoints >= COST_CONCEPT_VIDEO) {
          if (!isPending) createVideo(data);
        } else {
          showMutationToast({
            success: false,
            message: `Not enough reputation points. Video costs ${COST_CONCEPT_VIDEO} points.`,
          });
        }
      }
    },
    (errors) => console.log(errors),
  );

  // Handle form submit based on creation type
  const handleCreateNew = () => {
    if (creationType === "image") {
      void handleCreateImage();
    } else {
      void handleCreateVideo();
    }
  };

  return (
    <ContentBox
      title="Concept Art"
      subtitle="Create AI art"
      topRightCorntentBreakpoint="sm"
      topRightContent={
        <div className="flex flex-row items-center gap-1">
          <div>
            <User
              className={`h-6 w-6 hover:cursor-pointer ${only_own ? "text-orange-500" : ""}`}
              onClick={() => filterForm.setValue("only_own", !only_own)}
            />
          </div>
          <Select
            onValueChange={(e) =>
              filterForm.setValue("sort", e as (typeof sortOptions)[number])
            }
            defaultValue={sort}
            value={sort}
          >
            <SelectTrigger>
              <SelectValue placeholder={`None`} />
            </SelectTrigger>
            <SelectContent>
              {sortOptions.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            onValueChange={(e) =>
              filterForm.setValue("time_frame", e as (typeof timeFrame)[number])
            }
            defaultValue={time_frame}
            value={time_frame}
          >
            <SelectTrigger>
              <SelectValue placeholder={`None`} />
            </SelectTrigger>
            <SelectContent>
              {timeFrame.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {userData && (
            <Confirm2
              title="Create New"
              button={
                <Button id="new-art">
                  {isPending ? (
                    <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                  ) : (
                    <Sparkles className="mr-2 h-6 w-6" />
                  )}
                  New
                </Button>
              }
              disabled={isPending}
              proceed_label={`Create ${creationType === "image" ? "Image" : "Video"}`}
              onAccept={handleCreateNew}
            >
              <div className="flex flex-col gap-1">
                <p className="pb-3 italic">
                  You currently have{" "}
                  <b>{userData.reputationPoints} reputation points</b>.<br /> Creating
                  concept art costs reputation points to help cover the cost of running
                  AI models.
                </p>
                <Tabs
                  value={creationType}
                  onValueChange={(v) => setCreationType(v as "image" | "video")}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="image" className="flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      Image ({COST_CONCEPT_IMAGE} rep)
                    </TabsTrigger>
                    <TabsTrigger value="video" className="flex items-center gap-2">
                      <Video className="h-4 w-4" />
                      Video ({COST_CONCEPT_VIDEO} reps)
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="image" className="mt-4">
                    <ImageCreationForm form={promptForm} />
                  </TabsContent>
                  <TabsContent value="video" className="mt-4">
                    <VideoCreationForm form={videoPromptForm} />
                  </TabsContent>
                </Tabs>
                <p className="pt-3 text-xs text-muted-foreground">
                  By creating concept art, you agree that it may be used for
                  advertisement purposes by TheNinja-RPG.
                </p>
              </div>
            </Confirm2>
          )}
        </div>
      }
    >
      <div className="relative grid w-full grow grid-cols-2 sm:grid-cols-3 md:grid-cols-4 ">
        {allImage?.map((image, i) => {
          return (
            <div
              key={image.id}
              ref={i === allImage.length - 1 ? setLastElement : null}
              className="p-2 text-white"
            >
              <Link href={`/conceptart/${image.id}`} aria-label={`Image ${image.id}`}>
                <ConceptImage image={image} />
              </Link>
            </div>
          );
        })}
      </div>
    </ContentBox>
  );
}

/** Form component for creating images */
const ImageCreationForm: React.FC<{
  form: ReturnType<typeof useForm<ConceptPromptType>>;
}> = ({ form }) => (
  <Form {...form}>
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="prompt"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Prompt</FormLabel>
            <FormControl>
              <Input placeholder="Describe your image..." {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="seed"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Seed value</FormLabel>
            <FormControl>
              <Input placeholder="Seed value" type="number" {...field} />
            </FormControl>
            <FormDescription>Use the same seed to get similar results</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  </Form>
);

/** Form component for creating videos */
const VideoCreationForm: React.FC<{
  form: ReturnType<typeof useForm<ConceptVideoPromptType>>;
}> = ({ form }) => (
  <Form {...form}>
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="prompt"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Prompt</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Describe your video scene..."
                className="min-h-[80px]"
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="negative_prompt"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Negative Prompt (optional)</FormLabel>
            <FormControl>
              <Input placeholder="What to avoid in the video..." {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="seed"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Seed value</FormLabel>
            <FormControl>
              <Input placeholder="Seed value" type="number" {...field} />
            </FormControl>
            <FormDescription>Use the same seed to get similar results</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="grid grid-cols-2 gap-4">
        <FormField
          control={form.control}
          name="start_image"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Start Image (optional)</FormLabel>
              <FormControl>
                <ConceptArtImageSelector
                  value={field.value}
                  onChange={field.onChange}
                  label="First frame"
                />
              </FormControl>
              <FormDescription>First frame (max 256KB)</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="last_image"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Last Image (optional)</FormLabel>
              <FormControl>
                <ConceptArtImageSelector
                  value={field.value}
                  onChange={field.onChange}
                  label="Final frame"
                />
              </FormControl>
              <FormDescription>Final frame (max 256KB)</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  </Form>
);

/** Reusable component for selecting concept art images (upload or from gallery) */
const ConceptArtImageSelector: React.FC<{
  value?: string;
  onChange: (url: string) => void;
  label: string;
}> = ({ value, onChange, label }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "gallery">("upload");

  // Fetch user's own concept art images (only images, not videos)
  const { data: userImages, isLoading } = api.conceptart.getAll.useQuery(
    { only_own: true, sort: "Most Recent", time_frame: "All Time", limit: 50 },
    { enabled: isOpen && activeTab === "gallery" },
  );

  const imageOnlyArt =
    userImages?.data.filter((img) => img.mediaType === "image") ?? [];

  const handleSelectImage = (imageUrl: string) => {
    onChange(imageUrl);
    setIsOpen(false);
  };

  if (value) {
    return (
      <div className="flex justify-center">
        <div className="relative">
          <Image
            src={value}
            alt={`${label} preview`}
            width={120}
            height={200}
            className="rounded-md object-cover"
          />
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full h-24 border-dashed">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <ImagePlus className="h-8 w-8" />
            <span className="text-xs">Select {label}</span>
          </div>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Select {label}</DialogTitle>
        </DialogHeader>
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as "upload" | "gallery")}
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="gallery" className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              My Gallery
            </TabsTrigger>
          </TabsList>
          <TabsContent value="upload" className="mt-4">
            <UploadDropzone
              endpoint="conceptArtFrameUploader"
              onClientUploadComplete={(res) => {
                const url = res?.[0]?.ufsUrl;
                if (url) {
                  onChange(url);
                  setIsOpen(false);
                }
              }}
              onUploadError={(error: Error) => {
                showMutationToast({ success: false, message: error.message });
              }}
              className="ut-label:text-sm ut-allowed-content:text-xs ut-button:bg-primary"
            />
          </TabsContent>
          <TabsContent value="gallery" className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin" />
              </div>
            ) : imageOnlyArt.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground">
                <p>No concept art images found.</p>
                <p className="text-sm">Create some images first!</p>
              </div>
            ) : (
              <div className="h-[300px] overflow-y-auto">
                <div className="grid grid-cols-3 gap-2 p-1">
                  {imageOnlyArt.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => img.image && handleSelectImage(img.image)}
                      className="relative aspect-square rounded-md overflow-hidden hover:ring-2 hover:ring-primary transition-all"
                    >
                      {img.image && (
                        <Image
                          src={img.image}
                          alt={img.prompt.slice(0, 50)}
                          fill
                          className="object-cover"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};
