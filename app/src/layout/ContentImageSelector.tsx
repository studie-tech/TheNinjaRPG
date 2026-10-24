import { zodResolver } from "@hookform/resolvers/zod";
import { Edit, Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { api } from "@/app/_trpc/client";
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
import { HistoricalAiAvatar } from "@/layout/ProfileEdit";
import RichInput from "@/layout/RichInput";
import { getPrePrompts, REMOVE_BG_TYPES } from "@/libs/imagePrompts";
import { showMutationToast } from "@/libs/toast";
import { UploadButton } from "@/utils/uploadthing";
import {
  type ContentImageProvider,
  type PromptFormSchema,
  promptFormSchema,
} from "@/validators/ai";

interface ContentImageSelectorProps {
  label: string;
  imageUrl?: string | null;
  id: string;
  prompt: string;
  preprompt?: string;
  /** Generate a new view from a canonical image; editing still uses the current view. */
  referenceImageUrl?: string;
  /** Furniture uses a generator that preserves the fixed camera across painted views. */
  provider?: ContentImageProvider;
  emptyImageLabel?: string;
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
  // Replacing or removing the selected image invalidates pending image operations.
  const operationIdentity = `${id}:${props.referenceImageUrl ?? ""}:${imageUrl ?? ""}`;
  const operationIdentityRef = useRef(operationIdentity);
  if (operationIdentityRef.current !== operationIdentity) {
    operationGenerationRef.current += 1;
    operationIdentityRef.current = operationIdentity;
  }
  disabledRef.current = Boolean(props.disabled);
  if (props.disabled && !wasDisabledRef.current) {
    operationGenerationRef.current += 1;
  }
  wasDisabledRef.current = Boolean(props.disabled);
  const operationGeneration = operationGenerationRef.current;

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Tracks the URL of the most recently uploaded image so the dialog preview
  // reflects the upload immediately (before the parent re-renders with the new prop).
  const [localImage, setLocalImage] = useState<{
    url: string;
    generation: number;
  } | null>(null);

  // Clear local override when the parent updates imageUrl (e.g. form reset or variant switch).
  useEffect(() => {
    setLocalImage(null);
  }, [imageUrl, operationIdentity]);

  useEffect(
    () => () => {
      // A delayed generation must not write into a form that replaced this editor.
      operationGenerationRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (props.disabled) setIsModalOpen(false);
  }, [props.disabled]);

  // The displayed URL: prefer the locally-tracked upload, then the prop from the parent.
  const displayUrl =
    localImage?.generation === operationGenerationRef.current
      ? localImage.url
      : imageUrl;

  // Form for the prompt inputs
  const promptForm = useForm<PromptFormSchema>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: {
      systemPrompt: props.preprompt ?? getPrePrompts(type),
      userPrompt: prompt,
      editPrompt: "",
    },
  });

  useEffect(() => {
    promptForm.setValue("systemPrompt", props.preprompt ?? getPrePrompts(type));
  }, [promptForm, props.preprompt, type]);

  useEffect(() => {
    if (!promptForm.getFieldState("userPrompt").isDirty) {
      promptForm.setValue("userPrompt", prompt);
    }
  }, [promptForm, prompt]);

  // Create image with AI mutation
  const { mutate: createImg, isPending: load } = api.generativeAi.createImg.useMutation(
    {
      onSuccess: async (data) => {
        const isCurrentOperation =
          imageGenerationRef.current === operationGenerationRef.current &&
          !disabledRef.current;
        if (data.success && data.url && isCurrentOperation) {
          setLocalImage({ url: data.url, generation: operationGenerationRef.current });
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
        provider: props.provider,
        // Reference edits receive one prompt in both providers, so include the style contract.
        prompt: props.referenceImageUrl
          ? `${data.systemPrompt}\n${data.userPrompt}`
          : data.userPrompt,
        previousImg: props.referenceImageUrl,
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
        provider: props.provider,
        prompt:
          props.preprompt || props.referenceImageUrl
            ? `${data.systemPrompt}\nKeep the camera and design consistent. Preserve the viewing direction unless the correction explicitly changes it. ${data.editPrompt}`
            : data.editPrompt,
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
          if (!open) setLocalImage(null);
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
            {!displayUrl && props.emptyImageLabel ? (
              <div className="flex aspect-[4/3] max-w-[300px] items-center justify-center rounded-lg border p-4 text-muted-foreground text-sm">
                {props.emptyImageLabel}
              </div>
            ) : (
              <AvatarImage
                href={displayUrl ?? IMG_AVATAR_DEFAULT}
                alt={`${id}-avatar`}
                size={100}
                hover_effect={true}
                className={size === "square" ? "aspect-square" : "aspect-auto"}
                priority
              />
            )}
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
          <DialogContent className="max-h-[90vh] max-w-6xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit {label}</DialogTitle>
            </DialogHeader>

            <div className="flex h-full flex-col gap-6 md:flex-row">
              {/* Left side - Image */}
              <div className="flex flex-shrink-0 flex-col items-center">
                {!displayUrl && props.emptyImageLabel ? (
                  <div className="flex aspect-[4/3] w-64 items-center justify-center rounded-lg border p-4 text-center text-muted-foreground text-sm">
                    {props.emptyImageLabel}
                  </div>
                ) : (
                  <AvatarImage
                    href={displayUrl ?? IMG_AVATAR_DEFAULT}
                    alt={`${id}-avatar`}
                    size={300}
                    hover_effect={false}
                    className={size === "square" ? "aspect-square" : "aspect-auto"}
                    priority
                  />
                )}

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
                        setLocalImage({
                          url,
                          generation: operationGenerationRef.current,
                        });
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
                    <TabsTrigger value="create">
                      {props.referenceImageUrl
                        ? "Recreate from original"
                        : "Create new"}
                    </TabsTrigger>
                    <TabsTrigger value="edit">Edit current</TabsTrigger>
                  </TabsList>

                  <TabsContent
                    value="create"
                    className="mt-4 flex flex-1 flex-col gap-4"
                  >
                    <div className="min-h-0 flex-1">
                      <RichInput
                        plainText
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
                        plainText
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
                        plainText
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
              operationGeneration={operationGeneration}
              onUpdate={(url) => {
                if (
                  disabledRef.current ||
                  operationGeneration !== operationGenerationRef.current
                )
                  return;
                setLocalImage({ url, generation: operationGenerationRef.current });
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
