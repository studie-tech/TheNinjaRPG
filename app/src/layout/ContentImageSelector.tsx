import { zodResolver } from "@hookform/resolvers/zod";
import { Edit, Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
import { HistoricalAiAvatar } from "@/app/[shell]/profile/edit/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ContentType, IMG_ORIENTATION } from "@/drizzle/constants";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import Loader from "@/layout/Loader";
import RichInput from "@/layout/RichInput";
import { getPrePrompts, REMOVE_BG_TYPES } from "@/libs/imagePrompts";
import { showMutationToast } from "@/libs/toast";
import { UploadButton } from "@/utils/uploadthing";
import { type PromptFormSchema, promptFormSchema } from "@/validators/ai";

interface ContentImageSelectorProps {
  label: string;
  imageUrl?: string | null;
  id: string;
  prompt: string;
  allowImageUpload?: boolean;
  type: ContentType;
  onUploadComplete: (url: string) => void;
  size: IMG_ORIENTATION;
  maxDim: number;
  disabled?: boolean;
}

const ContentImageSelector: React.FC<ContentImageSelectorProps> = (props) => {
  // Destructure props
  const utils = api.useUtils();
  const { label, imageUrl, id, prompt, allowImageUpload, type } = props;
  const { onUploadComplete } = props;
  const { size, maxDim } = props;
  const disabledRef = useRef(Boolean(props.disabled));
  const wasDisabledRef = useRef(Boolean(props.disabled));
  const operationGenerationRef = useRef(0);
  const imageGenerationRef = useRef<number | null>(null);
  const uploadGenerationRef = useRef<number | null>(null);
  disabledRef.current = Boolean(props.disabled);
  if (props.disabled && !wasDisabledRef.current) {
    operationGenerationRef.current += 1;
  }
  wasDisabledRef.current = Boolean(props.disabled);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Tracks the URL of the most recently uploaded image so the dialog preview
  // reflects the upload immediately (before the parent re-renders with the new prop).
  const [localImageUrl, setLocalImageUrl] = useState<string | null>(null);

  // Clear local override when the parent updates imageUrl (e.g. form reset or variant switch).
  useEffect(() => {
    setLocalImageUrl(null);
  }, [imageUrl]);

  useEffect(() => {
    if (props.disabled) setIsModalOpen(false);
  }, [props.disabled]);

  // The displayed URL: prefer the locally-tracked upload, then the prop from the parent.
  const displayUrl = localImageUrl ?? imageUrl;

  // Form for the prompt inputs
  const promptForm = useForm<PromptFormSchema>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: {
      systemPrompt: getPrePrompts(type),
      userPrompt: prompt,
      editPrompt: "",
    },
  });

  // Create image with AI mutation
  const { mutate: createImg, isPending: load } = api.generativeAi.createImg.useMutation(
    {
      onSuccess: async (data) => {
        const isCurrentOperation =
          imageGenerationRef.current === operationGenerationRef.current &&
          !disabledRef.current;
        if (data.success && data.url && isCurrentOperation) {
          setLocalImageUrl(data.url);
          onUploadComplete(data.url);
          await utils.avatar.getHistoricalAvatars.invalidate();
        }
        showMutationToast(data);
      },
    },
  );

  const handleGenerateImage = (data: PromptFormSchema) => {
    if (!data.userPrompt) {
      showMutationToast({ success: false, message: "No user prompt" });
      return;
    } else if (!load) {
      // Send off the request for content image
      imageGenerationRef.current = operationGenerationRef.current;
      createImg({
        preprompt: data.systemPrompt,
        prompt: data.userPrompt,
        removeBg: REMOVE_BG_TYPES.includes(props.type ?? ""),
        relationId: id,
        size: size,
        maxDim: maxDim,
      });
    }
  };

  const handleEditImage = (data: PromptFormSchema) => {
    if (!displayUrl) {
      showMutationToast({ success: false, message: "No image to edit" });
      return;
    } else if (!data.editPrompt) {
      showMutationToast({ success: false, message: "No edit prompt" });
      return;
    } else if (!load) {
      // Use the edit prompt for image modification
      imageGenerationRef.current = operationGenerationRef.current;
      createImg({
        preprompt: data.systemPrompt,
        prompt: data.editPrompt,
        previousImg: displayUrl,
        removeBg: REMOVE_BG_TYPES.includes(props.type ?? ""),
        relationId: id,
        size: size,
        maxDim: maxDim,
      });
    }
  };

  return (
    <div className="flex flex-col justify-start">
      <Label>{label}</Label>
      <br />

      <Dialog
        open={isModalOpen}
        onOpenChange={(open) => {
          if (props.disabled) return;
          if (!open) setLocalImageUrl(null);
          setIsModalOpen(open);
        }}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            disabled={props.disabled}
            aria-label={`Edit ${label}`}
            className="group relative cursor-pointer disabled:cursor-wait disabled:opacity-60"
          >
            <AvatarImage
              href={displayUrl ?? IMG_AVATAR_DEFAULT}
              alt={`${id}-avatar`}
              size={100}
              hover_effect={true}
              className={size === "square" ? "aspect-square" : "aspect-auto"}
              priority
            />
            {allowImageUpload && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-opacity-0 transition-all duration-200 group-hover:bg-opacity-50">
                <Edit
                  className="text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  size={24}
                />
              </div>
            )}
          </button>
        </DialogTrigger>

        {allowImageUpload && (
          <DialogContent className="max-h-[90vh] max-w-6xl overflow-hidden">
            <DialogHeader>
              <DialogTitle>Edit {label}</DialogTitle>
            </DialogHeader>

            <div className="flex h-full flex-col gap-6 md:flex-row">
              {/* Left side - Image */}
              <div className="flex flex-shrink-0 flex-col items-center">
                <AvatarImage
                  href={displayUrl ?? IMG_AVATAR_DEFAULT}
                  alt={`${id}-avatar`}
                  size={300}
                  hover_effect={false}
                  className={size === "square" ? "aspect-square" : "aspect-auto"}
                  priority
                />

                {/* Upload button */}
                <div className="mt-4 flex flex-row gap-2">
                  <UploadButton
                    endpoint="imageUploader"
                    onUploadBegin={() => {
                      uploadGenerationRef.current = operationGenerationRef.current;
                    }}
                    onClientUploadComplete={(res) => {
                      if (
                        disabledRef.current ||
                        uploadGenerationRef.current !== operationGenerationRef.current
                      ) {
                        return;
                      }
                      const serverData = res?.[0]?.serverData;
                      if (serverData?.error) {
                        showMutationToast({
                          success: false,
                          message: serverData.error,
                        });
                        return;
                      }
                      const url = serverData?.fileUrl;
                      if (url) {
                        setLocalImageUrl(url);
                        onUploadComplete(url);
                        setIsModalOpen(false);
                      }
                    }}
                    onUploadError={(error: Error) => {
                      showMutationToast({ success: false, message: error.message });
                    }}
                  />
                </div>
              </div>

              {/* Right side - Text inputs */}
              <div className="flex flex-1 flex-col gap-4 overflow-hidden">
                <Tabs defaultValue="create" className="flex flex-1 flex-col">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="create">Create new</TabsTrigger>
                    <TabsTrigger value="edit">Edit current</TabsTrigger>
                  </TabsList>

                  <TabsContent
                    value="create"
                    className="mt-4 flex flex-1 flex-col gap-4"
                  >
                    <div className="min-h-0 flex-1">
                      <RichInput
                        id="systemPrompt"
                        label="System Prompt (AI Instructions)"
                        height="250px"
                        placeholder="Enter system prompt for AI image generation..."
                        control={promptForm.control}
                        disabled={load}
                      />
                    </div>

                    <div className="min-h-0 flex-1">
                      <RichInput
                        id="userPrompt"
                        label="User Prompt (Content Description)"
                        height="150px"
                        placeholder="Describe what you want to generate..."
                        control={promptForm.control}
                        disabled={load}
                      />
                    </div>

                    {/* Generate AI button for create */}
                    <div className="mt-4 flex justify-center">
                      <Button
                        className="h-12 w-full bg-green-600 px-8 hover:bg-green-700"
                        onClick={() => {
                          const formData = promptForm.getValues();
                          handleGenerateImage(formData);
                        }}
                        disabled={load}
                      >
                        {load ? (
                          <Loader noPadding={true} size={25} />
                        ) : (
                          <Sparkles className="mr-2 h-5 w-5" />
                        )}
                        Generate AI Image
                      </Button>
                    </div>
                  </TabsContent>

                  <TabsContent value="edit" className="mt-4 flex flex-1 flex-col gap-4">
                    <div className="min-h-0 flex-1">
                      <RichInput
                        id="editPrompt"
                        label="Edit Instructions"
                        height="300px"
                        placeholder="Describe how you want to modify the current image..."
                        control={promptForm.control}
                        disabled={load}
                      />
                    </div>

                    {/* Generate AI button for edit */}
                    <div className="mt-4 flex justify-center">
                      <Button
                        className="h-12 w-full bg-green-600 px-8 hover:bg-green-700"
                        onClick={() => {
                          const formData = promptForm.getValues();
                          handleEditImage(formData);
                        }}
                        disabled={load}
                      >
                        {load ? (
                          <Loader noPadding={true} size={25} />
                        ) : (
                          <Sparkles className="mr-2 h-5 w-5" />
                        )}
                        Edit Image
                      </Button>
                    </div>
                  </TabsContent>
                </Tabs>
              </div>
            </div>
            <HistoricalAiAvatar
              relationId={id}
              contentType={type}
              disabled={props.disabled}
              operationGeneration={operationGenerationRef.current}
              onUpdate={(url) => {
                if (disabledRef.current) return;
                setLocalImageUrl(url);
                onUploadComplete(url);
              }}
              size={size}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
};

export default ContentImageSelector;
