"use client";

import { History, Sparkles, SwitchCamera, Upload } from "lucide-react";
import type React from "react";
import { useRef } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COST_GENERATE_AVATAR } from "@/drizzle/constants";
import AvatarImage from "@/layout/Avatar";
import Confirm from "@/layout/Confirm";
import { HistoricalAiAvatar } from "@/layout/HistoricalAiAvatar";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { getUserFederalStatus } from "@/utils/paypal";
import { capitalizeFirstLetter } from "@/utils/string";
import { useRequiredUserData } from "@/utils/UserContext";
import { readUploadResult, showUploadError, UploadButton } from "@/utils/uploadthing";

/** Group avatar generation, history, and uploads without mounting inactive panels. */
export function AvatarSettings() {
  return (
    <Tabs defaultValue="generate">
      <TabsList className="mb-4 flex h-auto w-full flex-wrap gap-1">
        <TabsTrigger value="generate" className="min-h-10 flex-1 gap-2">
          <Sparkles aria-hidden="true" className="h-4 w-4" />
          Generate
        </TabsTrigger>
        <TabsTrigger value="previous" className="min-h-10 flex-1 gap-2">
          <History aria-hidden="true" className="h-4 w-4" />
          Previous
        </TabsTrigger>
        <TabsTrigger value="upload" className="min-h-10 flex-1 gap-2">
          <Upload aria-hidden="true" className="h-4 w-4" />
          Upload
        </TabsTrigger>
      </TabsList>
      <TabsContent value="generate">
        <NewAiAvatar />
      </TabsContent>
      <TabsContent value="previous">
        <HistoricalAiAvatar contentType="user" />
      </TabsContent>
      <TabsContent value="upload">
        <p className="mb-3 text-muted-foreground text-sm">
          Upload a custom avatar. Image size limits depend on your federal support
          status.
        </p>
        <AvatarChange />
      </TabsContent>
    </Tabs>
  );
}

/** Generate a paid avatar and apply the server's authoritative cache update. */
const NewAiAvatar: React.FC = () => {
  // Queries & mutations
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();

  // tRPC utility
  const utils = api.useUtils();

  // Create new avatar mutation
  const createAvatar = api.avatar.createAvatar.useMutation({
    onMutate: prepareUserUpdate,
    onSuccess: async (data, _input, revision) => {
      showMutationToast(data);
      await Promise.all([
        updateUser(data, { revision }),
        utils.avatar.getHistoricalAvatars.invalidate(),
      ]);
    },
  });
  const userAttributes = api.profile.getUserAttributes.useQuery(undefined, {
    enabled: !!userData,
  });

  if (createAvatar.isPending) return <Loader explanation="Processing" />;

  return (
    <div className="@container/avatar">
      <div className="grid gap-5 @min-[400px]/avatar:grid-cols-[144px_minmax(0,1fr)]">
        <div>
          {userData && (
            <AvatarImage
              href={userData.avatar}
              alt={userData.username}
              size={512}
              priority
              className="w-36"
            />
          )}
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold">Current attributes</h3>
          <ul className="mt-2 grid list-inside list-disc gap-x-3 gap-y-1 text-sm @min-[480px]/avatar:grid-cols-2">
            <li key="rank">
              {userData?.rank ? capitalizeFirstLetter(userData.rank) : ""}
            </li>
            {userAttributes.data?.map((attribute) => (
              <li key={attribute.id}>{attribute.attribute}</li>
            ))}
          </ul>
          <h3 className="mt-5 font-semibold">Create a new avatar</h3>

          {userData && userData.reputationPoints >= COST_GENERATE_AVATAR ? (
            <>
              <p className="mb-3 text-muted-foreground text-sm">
                Costs {COST_GENERATE_AVATAR} reputation point
              </p>
              <Confirm
                title="Confirm Avatar Change"
                proceed_label="Create avatar"
                proceed_loading_label="Creating"
                isLoading={createAvatar.isPending}
                disabled={createAvatar.isPending}
                button={
                  <Button id="create" className="min-h-11 w-full">
                    <SwitchCamera className="mr-2 h-5 w-5" />
                    New Avatar
                  </Button>
                }
                onAccept={(e) => {
                  e.preventDefault();
                  createAvatar.mutate();
                }}
              >
                Changing your avatar will cost {COST_GENERATE_AVATAR} reputation point.
                We would love to enable unlimited re-creations, but the model generating
                the avatars runs on NVidia A100 GPU cluster, and each generation costs a
                little bit of money. We are working on a solution to make this free, but
                for now, we need to charge a small fee to cover the cost of the GPU
                cluster.
              </Confirm>
            </>
          ) : (
            <p className="text-red-500">
              Requires {COST_GENERATE_AVATAR} reputation point
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Avatar change component
 */
const AvatarChange: React.FC = () => {
  // State
  const { data: userData, prepareUserUpdate, updateUser } = useRequiredUserData();
  const uploadRevision = useRef<number | undefined>(undefined);

  // Only show if we have userData
  if (!userData) return <Loader explanation="Loading profile page..." />;

  // Get user status
  const userstatus = getUserFederalStatus(userData);

  // If we have federal support
  if (userstatus !== "NONE") {
    return (
      <div className="grid grid-cols-2 pt-2">
        <AvatarImage
          href={userData.avatar}
          alt={userData.userId}
          size={100}
          hover_effect={true}
          priority
        />
        <UploadButton
          endpoint={
            userstatus === "NORMAL"
              ? "avatarNormalUploader"
              : userstatus === "SILVER"
                ? "avatarSilverUploader"
                : "avatarGoldUploader"
          }
          onUploadBegin={() => {
            uploadRevision.current = prepareUserUpdate();
          }}
          onClientUploadComplete={(res) => {
            const serverData = readUploadResult(res);
            if (serverData?.fileUrl) {
              if ("userPatch" in serverData && serverData.userPatch)
                void updateUser(serverData.userPatch, {
                  revision: uploadRevision.current,
                });
              else void updateUser(undefined, { revision: uploadRevision.current });
            }
          }}
          onUploadError={showUploadError}
        />
      </div>
    );
  } else {
    return (
      <Link href="/points">
        <Button id="create" className="my-3 w-full">
          Purchase Federal Support
        </Button>
      </Link>
    );
  }
};
