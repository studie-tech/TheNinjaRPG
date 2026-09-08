"use client";

import Link from "next/link";
import { api } from "@/app/_trpc/client";
import AvatarImage from "@/layout/Avatar";
import ConceptImage from "@/layout/ConceptImage";
import ContentBox, { type ContentBoxProps } from "@/layout/ContentBox";
import Loader from "@/layout/Loader";

interface ConceptBox_ConceptImageProps
  extends Omit<ContentBoxProps, "title" | "subtitle" | "children"> {
  imageid?: string;
  /**
   * Prompt and creator resolved during the server render.
   *
   * The media itself still arrives with the client query, but seeding these two means
   * the served HTML describes this particular piece rather than being the same spinner
   * on every /conceptart/* URL.
   */
  seed?: { prompt: string; creator: string | null };
}

const ConceptBox_ConceptImage: React.FC<ConceptBox_ConceptImageProps> = (props) => {
  const { seed, ...boxProps } = props;

  // Fetch data
  // Use isLoading (not isFetching) to only show loader on initial load
  // This prevents unmounting ConceptImage during background refetches
  const { data: image, isLoading } = api.conceptart.get.useQuery(
    { id: props.imageid ?? "" },
    { enabled: !!props.imageid },
  );

  // Guard - only show loader on initial load, not background refetches
  if (isLoading) {
    if (!seed) return <Loader explanation="Fetching media" />;
    return (
      <ContentBox
        {...boxProps}
        title="Concept Art"
        subtitle={`Created by ${seed.creator || "unknown"}`}
      >
        <p className="mb-3">{seed.prompt}</p>
        <Loader explanation="Fetching media" />
      </ContentBox>
    );
  }

  // Render
  return (
    <ContentBox
      {...boxProps}
      title="Concept Art"
      subtitle={`Created by ${image?.user?.username || "unknown"}`}
      topRightContent={
        image && (
          <div className="w-14">
            <Link
              href={`/username/${image?.user?.username}`}
              aria-label={image?.user?.username || "unknown user"}
            >
              <AvatarImage
                href={image.user.avatar}
                alt={image.userId}
                size={100}
                hover_effect={true}
                priority
              />
            </Link>
          </div>
        )
      }
    >
      {image && (
        <ConceptImage image={image} showDetails={true} width={768} height={1344} />
      )}
      {!image && <div>Image could not be found anymore</div>}
    </ContentBox>
  );
};

export default ConceptBox_ConceptImage;
