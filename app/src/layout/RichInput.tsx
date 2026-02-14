import { zodResolver } from "@hookform/resolvers/zod";
import { PartyPopper, SendHorizontal } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { Control } from "react-hook-form";
import { Controller, useController, useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Textarea } from "@/components/ui/textarea";
import EmojiPicker from "@/layout/EmojiPicker";
import { showMutationToast } from "@/libs/toast";
import { resizeImage } from "@/utils/image";
import { useUploadThing } from "@/utils/uploadthing";
import { getSearchValidator } from "@/validators/register";
import UserSearchSelect from "./UserSearchSelect";

interface RichInputProps {
  id: string;
  refreshKey?: number;
  label?: string;
  height: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  control: Control<any>;
  onSubmit?: (e: any) => void;
  isDirty?: boolean;
  enableMentions?: boolean;
  allowClipboardPaste?: boolean;
  autoFocus?: boolean;
}

const RichInput: React.FC<RichInputProps> = (props) => {
  // Reference for emoji element
  const emojiRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Is emoji popover open
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Show mentions interface
  const [showMentions, setShowMentions] = useState(false);
  // Cursor position for mention insertion
  const [cursorPosition, setCursorPosition] = useState<{
    start: number;
    end: number;
  } | null>(null);

  // Form for UserSearchSelect
  const maxUsers = 1;
  const userSearchSchema = getSearchValidator({ max: maxUsers });
  const mentionForm = useForm<z.infer<typeof userSearchSchema>>({
    resolver: zodResolver(userSearchSchema),
    defaultValues: { username: "", users: [] },
  });

  // Watch for selected users with useWatch instead of .watch
  const selectedUsers = useWatch({
    control: mentionForm.control,
    name: "users",
    defaultValue: [],
  });

  const { field } = useController({
    name: props.id,
    control: props.control,
    rules: { required: true },
  });

  const { startUpload } = useUploadThing("tavernUploader", {
    onClientUploadComplete: () => {
      // Handle upload complete if needed
    },
    onUploadError: (error: Error) => {
      showMutationToast({ success: false, message: error.message });
    },
  });

  // Handle clipboard paste
  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!props.allowClipboardPaste) return;

    const items = e.clipboardData.items;
    const imageItem = Array.from(items).find((item) => item.type.startsWith("image"));

    if (imageItem) {
      e.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;

      // Insert loading text at cursor position
      const loadingText = "![Uploading image...](uploading)";
      const cursorPos = e.currentTarget.selectionStart;
      const textBefore = ((field.value as string) || "").substring(0, cursorPos);
      const textAfter = ((field.value as string) || "").substring(cursorPos);
      const textWhileUploading = textBefore + loadingText + textAfter;
      field.onChange(textWhileUploading);

      try {
        // Resize the image before uploading
        const resizedFile = await resizeImage(file);

        // Upload the resized file using useUploadThing hook
        const uploadResponse = await startUpload([resizedFile]);
        const uploadedFile = uploadResponse?.[0];

        // Check if we have a successful upload with a URL
        if (!uploadedFile) {
          throw new Error("Upload failed - no response");
        }

        const uploadUrl = uploadedFile.url;
        if (!uploadUrl) {
          throw new Error("Upload failed - no URL returned");
        }
        // Replace the loading text with the actual image markdown
        const imgHtml = `<img src="${uploadUrl}" alt="${file.name}" />`;
        const newText = textWhileUploading.replace(loadingText, imgHtml);
        field.onChange(newText);
      } catch (error) {
        // Remove the loading text if upload failed
        const newText = ((field.value as string) ?? "").replace(loadingText, "");
        field.onChange(newText);
        showMutationToast({
          success: false,
          message: error instanceof Error ? error.message : "Failed to upload image",
        });
      }
    }
  };

  // Handle button clicks
  const onDocumentKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case "Enter":
        if (
          !event.shiftKey &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.metaKey &&
          !props.disabled &&
          document.activeElement?.id === props.id &&
          !showMentions
        ) {
          event.preventDefault();
          const value = (props.control._formValues[props.id] || "") as string;
          if (props.onSubmit) props.onSubmit(value);
          event.preventDefault();
        }
        break;
    }
  };

  // Add button handler
  useEffect(() => {
    if (props.onSubmit) {
      document.addEventListener("keydown", onDocumentKeyDown);
      return () => {
        document.removeEventListener("keydown", onDocumentKeyDown);
      };
    }
  }, [showMentions]);

  // Handler for clicks outside emoji selector
  const handleOutsideClick = (e: MouseEvent) => {
    if (emojiRef.current && !emojiRef.current.contains(e.target as HTMLElement)) {
      setEmojiOpen(false);
    }
  };

  // Handle clicks outside of the emoji element
  useEffect(() => {
    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  });

  // Function to check for mentions
  const checkForMention = (text: string) => {
    if (!props.enableMentions) return;

    // Get the current cursor position
    const cursorPos = textareaRef.current?.selectionStart || 0;

    // Get text up to cursor position
    const textUpToCursor = text.substring(0, cursorPos);

    // Find the last word being typed (from last space or beginning of text to cursor)
    const lastSpacePos = textUpToCursor.lastIndexOf(" ");
    const lastNewlinePos = textUpToCursor.lastIndexOf("\n");
    const startPos = Math.max(lastSpacePos, lastNewlinePos) + 1;
    const lastWord = textUpToCursor.substring(startPos);

    if (lastWord.startsWith("@") && lastWord.length > 1) {
      const query = lastWord.substring(1); // Remove @ symbol
      mentionForm.setValue("username", query);
      setShowMentions(true);
      setCursorPosition({ start: startPos, end: cursorPos });
    } else {
      setShowMentions(false);
    }
  };

  // Handle text changes
  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    field.onChange(e);
    checkForMention(e.target.value);
  };

  // Handle user selection from UserSearchSelect
  useEffect(() => {
    if (selectedUsers.length > 0 && cursorPosition) {
      // Get the latest selected user
      const lastSelectedUser = selectedUsers[selectedUsers.length - 1];

      // Safely check if we have a valid user with optional chaining
      if (lastSelectedUser?.username) {
        const currentValue = (field.value as string) || "";

        // Replace the @mention query with the selected username
        const before = currentValue.substring(0, cursorPosition.start);
        const after = currentValue.substring(cursorPosition.end);
        const newValue = `${before}@${lastSelectedUser.username} ${after}`;

        field.onChange(newValue);

        // Reset the mentions interface
        setShowMentions(false);
        mentionForm.setValue("users", []);
        mentionForm.setValue("username", "");

        // Set focus back to textarea
        const timeoutId = setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            const newCursorPos = before.length + lastSelectedUser.username.length + 2; // +2 for @ and space
            textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
          }
        }, 0);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [selectedUsers]);

  return (
    <div className={`${props.disabled ? "opacity-50" : ""}`}>
      <label htmlFor={props.id} className="mb-2 block font-medium text-sm">
        {props.label}
      </label>
      <div className="relative">
        <Controller
          key={props.refreshKey}
          name={props.id}
          control={props.control}
          rules={{ required: true }}
          render={({ field: controllerField }) => {
            return (
              <Textarea
                {...controllerField}
                ref={(e) => {
                  textareaRef.current = e;
                }}
                id={props.id}
                autoFocus={props.autoFocus ?? true}
                isDirty={props.isDirty}
                placeholder={props.placeholder}
                className="w-full"
                onChange={handleTextChange}
                onPaste={handlePaste}
              />
            );
          }}
        />

        <div
          className="absolute top-0 left-[50%] z-50 translate-x-[-50%]"
          ref={emojiRef}
        >
          {emojiOpen && (
            <EmojiPicker
              onSelect={(native) => {
                const current = (field.value as string) || "";
                field.onChange(current + native);
                setEmojiOpen(false);
              }}
              onClickOutside={() => setEmojiOpen(false)}
            />
          )}
        </div>

        <div className="absolute top-[50%] right-5 flex translate-y-[-50%] flex-row items-center">
          <PartyPopper
            className="h-8 w-8 text-gray-400 opacity-50 hover:cursor-pointer hover:text-gray-600"
            onClick={() => setEmojiOpen(!emojiOpen)}
          />
          {props.onSubmit && (
            <SendHorizontal
              className="h-8 w-8 text-gray-400 opacity-50 hover:cursor-pointer hover:text-gray-600"
              onClick={(e) => {
                if (props.onSubmit) {
                  props.onSubmit(e);
                }
              }}
            />
          )}
        </div>

        {showMentions && props.enableMentions && (
          <div className="absolute right-0 left-0 z-50 mt-1">
            <UserSearchSelect
              useFormMethods={mentionForm}
              showYourself={true}
              inline={true}
              maxUsers={1}
              showAi={true}
            />
          </div>
        )}
      </div>

      {props.error && <div className="text-red-500 text-xs italic"> {props.error}</div>}
    </div>
  );
};

export default RichInput;
