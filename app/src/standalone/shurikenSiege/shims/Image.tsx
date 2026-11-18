import type { CSSProperties } from "react";
import { transformImageUrl } from "@/utils/image";

/** Stands in for the app's Next.js Image: a plain image served from the build's files. */
export default function Image(props: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
  style?: CSSProperties;
  priority?: boolean;
  sizes?: string;
  quality?: number;
  unoptimized?: boolean;
}) {
  return (
    <img
      src={transformImageUrl(props.src)}
      alt={props.alt}
      width={props.fill ? undefined : props.width}
      height={props.fill ? undefined : props.height}
      className={props.className}
      style={
        props.fill
          ? {
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              ...props.style,
            }
          : props.style
      }
      loading={props.priority ? "eager" : "lazy"}
      decoding="async"
    />
  );
}
