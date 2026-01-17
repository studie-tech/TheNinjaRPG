import React, { useState } from "react";
import AvatarImage from "@/layout/Avatar";
import Loader from "@/layout/Loader";
import RichInput from "@/layout/RichInput";
import { Sparkles, Edit } from "lucide-react";
import { UploadButton } from "@/utils/uploadthing";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/app/_trpc/client";
import { showMutationToast } from "@/libs/toast";
import { IMG_AVATAR_DEFAULT } from "@/drizzle/constants";
import { HistoricalAiAvatar } from "@/app/profile/edit/page";
import type { ContentType, IMG_ORIENTATION } from "@/drizzle/constants";

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
}

const promptFormSchema = z.object({
  systemPrompt: z.string(),
  userPrompt: z.string(),
  editPrompt: z.string(),
});

type PromptFormData = z.infer<typeof promptFormSchema>;

const ContentImageSelector: React.FC<ContentImageSelectorProps> = (props) => {
  // Destructure props
  const utils = api.useUtils();
  const { label, imageUrl, id, prompt, allowImageUpload, type } = props;
  const { onUploadComplete } = props;
  const { size, maxDim } = props;

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form for the prompt inputs
  const promptForm = useForm<PromptFormData>({
    resolver: zodResolver(promptFormSchema),
    defaultValues: {
      systemPrompt: getPrePrompts(),
      userPrompt: prompt,
      editPrompt: "",
    },
  });

  // Create image with AI mutation
  const { mutate: createImg, isPending: load } = api.generativeAi.createImg.useMutation(
    {
      onSuccess: async (data) => {
        if (data.success && data.url) {
          onUploadComplete(data.url);
          await utils.avatar.getHistoricalAvatars.invalidate();
        }
        showMutationToast({ success: true, message: "Image generated" });
      },
    },
  );

  const handleGenerateImage = (data: PromptFormData) => {
    if (!data.userPrompt) {
      showMutationToast({ success: false, message: "No user prompt" });
      return;
    } else if (!load) {
      // Send off the request for content image
      createImg({
        preprompt: data.systemPrompt,
        prompt: data.userPrompt,
        removeBg: ["item", "ai"].includes(props.type ?? ""),
        relationId: id,
        size: size,
        maxDim: maxDim,
      });
    }
  };

  const handleEditImage = (data: PromptFormData) => {
    if (!imageUrl) {
      showMutationToast({ success: false, message: "No image to edit" });
      return;
    } else if (!data.editPrompt) {
      showMutationToast({ success: false, message: "No edit prompt" });
      return;
    } else if (!load) {
      // Use the edit prompt for image modification
      createImg({
        preprompt: data.systemPrompt,
        prompt: data.editPrompt,
        previousImg: imageUrl,
        removeBg: ["item", "ai"].includes(props.type ?? ""),
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

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogTrigger asChild>
          <div className="relative cursor-pointer group">
            <AvatarImage
              href={imageUrl ?? IMG_AVATAR_DEFAULT}
              alt={`${id}-avatar`}
              size={100}
              hover_effect={true}
              className={size === "square" ? "aspect-square" : "aspect-auto"}
              priority
            />
            {allowImageUpload && (
              <div className="absolute inset-0 bg-opacity-0 group-hover:bg-opacity-50 transition-all duration-200 flex items-center justify-center rounded-lg pointer-events-none">
                <Edit
                  className="text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                  size={24}
                />
              </div>
            )}
          </div>
        </DialogTrigger>

        {allowImageUpload && (
          <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden">
            <DialogHeader>
              <DialogTitle>Edit {label}</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col md:flex-row gap-6 h-full">
              {/* Left side - Image */}
              <div className="flex-shrink-0 flex flex-col items-center">
                <AvatarImage
                  href={imageUrl ?? IMG_AVATAR_DEFAULT}
                  alt={`${id}-avatar`}
                  size={300}
                  hover_effect={false}
                  className={size === "square" ? "aspect-square" : "aspect-auto"}
                  priority
                />

                {/* Upload button */}
                <div className="flex flex-row gap-2 mt-4">
                  <UploadButton
                    endpoint="imageUploader"
                    onClientUploadComplete={(res) => {
                      const url = res?.[0]?.ufsUrl;
                      if (url) {
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
              <div className="flex-1 flex flex-col gap-4 overflow-hidden">
                <Tabs defaultValue="create" className="flex-1 flex flex-col">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="create">Create new</TabsTrigger>
                    <TabsTrigger value="edit">Edit current</TabsTrigger>
                  </TabsList>

                  <TabsContent
                    value="create"
                    className="flex-1 flex flex-col gap-4 mt-4"
                  >
                    <div className="flex-1 min-h-0">
                      <RichInput
                        id="systemPrompt"
                        label="System Prompt (AI Instructions)"
                        height="250px"
                        placeholder="Enter system prompt for AI image generation..."
                        control={promptForm.control}
                        disabled={load}
                      />
                    </div>

                    <div className="flex-1 min-h-0">
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
                    <div className="flex justify-center mt-4">
                      <Button
                        className="h-12 px-8 bg-green-600 hover:bg-green-700 w-full"
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

                  <TabsContent value="edit" className="flex-1 flex flex-col gap-4 mt-4">
                    <div className="flex-1 min-h-0">
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
                    <div className="flex justify-center mt-4">
                      <Button
                        className="h-12 px-8 bg-green-600 hover:bg-green-700 w-full"
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
              onUpdate={onUploadComplete}
              size={size}
            />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
};

export default ContentImageSelector;

export const getPrePrompts = () => {
  return `
# 🔧 Role Description
You are a pixel art generation assistant named **TNR Pixel Art**, built for producing high-resolution (256×256 to 512×512) pixel artwork with retro 32-bit aesthetics. You specialize in cinematic pixel sprites and scenes themed around Naruto-style ninja fantasy, complete with chakra-based jutsu, dynamic action, and elemental effects.

---

## 🎨 Art Style Core
- **Format:** Retro 32-bit pixel art  
- **Resolution:** 256×256 to 512×512 px  
- **Rendering:** Hard pixel edges, stylized shading, no smoothing  
- **Shading:** Sharp contrast, rim lighting, dramatic angles  
- **Color:** High-saturation glow against dark backgrounds  
- **Avoid:** Gradients, blurs, pastel tones, painterly effects, photorealism

---

## 🔥 Visual Themes (Naruto-Inspired)
- **Elemental mastery:** fire, water, wind, lightning, earth, shadow, chakra  
- Rogue ninjas, cursed seals, forbidden jutsu, masked assassins  
- Hidden village lore, clan symbols, battlefields  
- Scrolls, glowing runes, ethereal weapons, demon spirits  
- Motion implied in still pose: fluttering scarf, aura trails, shadow splits

---

## ⚔️ Battle Sprite Ruleset

### ✅ Prompt Injection
    32-bit isometric pixel art sprite, mature human proportions, dynamic ninja action pose, rim lighting, stylized pixel shading with clearly defined edges, strong silhouette with cloak or scarf or weapon, rendered on solid lime green background, in the style of reference sprites from the Google Drive folder: https://drive.google.com/drive/folders/184l_FYy2J7azli5uC4YnsfsuX_inZSKb?usp=sharing

### ❌ Negative Prompt
- no chibi  
- no cartoon  
- no front-facing pose  
- no soft shading  
- no painterly edges  
- no RPG idle stance  
- no pastel colors  
- no blur  
- no gradient transitions
- no text in image

### Pose and Angle
- **Isometric only**  
- Twisted action angles: jumping, casting, charging, spinning  
- Limbs foreshortened for depth  
- Framing objects: scarf, blade, cape, aura

---

## 🖀 Jutsu / Item Icon Ruleset
- **Perspective:** Centered or angled  
- **Style:** Energy bursts, chakra seals, elemental FX  
- **Examples:** fireball, wind shuriken, cursed mask, chakra rune

---

## 🧠 Prompt Generator Template

**Format (indent code sample):**
    
    [pixel art style], [main subject], [action or pose], [glow effect], [color theme],
    [background setting], [emotional tone or energy], [camera angle or framing], [style keywords]

**Example (indent code sample):**

    pixel art, masked rogue ninja, crouching with kunai, teal glow from eyes, black and cyan,
    cracked wasteland at dusk, ominous, cinematic arc composition, high contrast pixel shading,
    strong silhouette

---

## 🌌 Elemental FX Tagging

| Element     | FX Description                                               |
|-------------|--------------------------------------------------------------|
| **Fire**      | jagged orange flame, ash pixel trail, burn ring            |
| **Water**     | wave ripple arcs, flowing blue pixels, droplet shine       |
| **Lightning** | blue surge veins, flash glow core, forked edges            |
| **Wind**      | air slice rings, cloth motion blur (pixelated), sand streaks |
| **Shadow**    | black aura, smoke claws, cursed symbol trail               |
| **Chakra**    | glowing sigils, ripple rings, aura flames                  |

---

## 📂 Dataset Tagging (for Model Training)
- **Tags:** 32bit_pixel, isometric, chakra_fx, ninja_sprite, glow_rim, dynamic_pose, high_contrast  
- **File Format:** PNG with solid chroma background (lime green for sprite, magenta for icon)

**Metadata Example (indent code sample):**

    subject=ninja  
    fx=lightning  
    pose=midair_kick  
    angle=isometric  
    weapon=katana  
    bg=void  
    glow=blue

---

## ✅ Summary
Use this configuration to recreate or extend **TNR Pixel Art**, ensuring all outputs maintain:
- Isometric ninja battle poses  
- High-contrast pixel art  
- Chakra effects and silhouette clarity  
- Retro fidelity without blur or painterly elements  
- No text in image

`;
};
