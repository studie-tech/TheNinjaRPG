"use client";

import { api } from "@/app/_trpc/client";
import Link from "next/link";
import AvatarImage from "@/layout/Avatar";
import ConceptImage from "@/layout/ConceptImage";
import ContentBox, { type ContentBoxProps } from "@/layout/ContentBox";
import Loader from "@/layout/Loader";

interface ConceptBox_ConceptImageProps
  extends Omit<ContentBoxProps, "title" | "subtitle" | "children"> {
  imageid?: string;
}

const ConceptBox_ConceptImage: React.FC<ConceptBox_ConceptImageProps> = (props) => {
  // Fetch data
  // Use isLoading (not isFetching) to only show loader on initial load
  // This prevents unmounting ConceptImage during background refetches
  const { data: image, isLoading } = api.conceptart.get.useQuery(
    { id: props.imageid ?? "" },
    { enabled: !!props.imageid },
  );

  // Guard - only show loader on initial load, not background refetches
  if (isLoading) return <Loader explanation="Fetching media" />;

  // Render
  return (
    <ContentBox
      {...props}
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
