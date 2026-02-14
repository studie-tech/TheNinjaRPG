interface ImageResizeOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number; // 0 to 1, where 1 is highest quality
  maintainAspectRatio?: boolean;
  outputFormat?: "webp" | "jpeg" | "png" | "original";
}

/**
 * Resizes and compresses an image to fit within maxWidth x maxHeight
 * @param file The image file to resize and compress
 * @param options Configuration options for resizing and compression
 * @returns A promise that resolves to a File object containing the resized image
 */
export const resizeImage = async (
  file: File,
  options: ImageResizeOptions = {},
): Promise<File> => {
  const {
    maxWidth = 512,
    maxHeight = 512,
    quality = 0.7,
    maintainAspectRatio = true,
    outputFormat = "webp",
  } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = URL.createObjectURL(file);

    img.onload = () => {
      // Calculate new dimensions
      let width = img.width;
      let height = img.height;

      if (maintainAspectRatio) {
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
      } else {
        width = Math.min(width, maxWidth);
        height = Math.min(height, maxHeight);
      }

      // Create canvas and resize
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Failed to get canvas context"));
        return;
      }

      // Enable image smoothing for better quality
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      // Draw resized image
      ctx.drawImage(img, 0, 0, width, height);

      // Determine output mime type
      let outputMimeType: string;
      let outputExtension: string;
      switch (outputFormat) {
        case "webp":
          outputMimeType = "image/webp";
          outputExtension = ".webp";
          break;
        case "jpeg":
          outputMimeType = "image/jpeg";
          outputExtension = ".jpg";
          break;
        case "png":
          outputMimeType = "image/png";
          outputExtension = ".png";
          break;
        default:
          outputMimeType = file.type;
          outputExtension = `.${file.name.split(".").pop()}`;
      }

      // Convert to blob with compression
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Failed to create blob"));
            return;
          }

          // Create new filename with appropriate extension
          const originalName = file.name.split(".").slice(0, -1).join(".");
          const newFileName =
            outputFormat === "original"
              ? file.name
              : `${originalName}${outputExtension}`;

          // Create new file from blob
          const resizedFile = new File([blob], newFileName, {
            type: outputMimeType,
            lastModified: Date.now(),
          });

          resolve(resizedFile);
        },
        outputMimeType,
        quality, // Configurable quality parameter
      );
    };

    img.onerror = () => {
      reject(new Error("Failed to load image"));
    };
  });
};
