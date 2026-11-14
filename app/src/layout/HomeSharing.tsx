"use client";

import { useState } from "react";
import { api } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import UserRequestSystem from "@/layout/UserRequestSystem";

/** Keep accepted home invitations in the shared request system for visits and revocation. */
export const HomeSharing = ({
  isPublic,
  revision,
  userId,
  onChanged,
}: {
  isPublic: boolean;
  revision: number;
  userId: string;
  onChanged: () => Promise<unknown>;
}) => {
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [isChanging, setIsChanging] = useState(false);
  const requests = api.home.getHomeRequests.useQuery(undefined, { staleTime: 0 });
  const sharing = api.home.setHomeSharing.useMutation();
  const invite = api.home.inviteHomeVisitor.useMutation();
  const accept = api.home.acceptHomeInvitation.useMutation();
  const reject = api.home.rejectHomeInvitation.useMutation();
  const cancel = api.home.cancelHomeInvitation.useMutation();

  /** Keep feedback and pending state beside the controls through refreshing access changes. */
  const change = async (
    action: () => Promise<{ success: boolean; message: string }>,
    { refreshHome = false, clearUsername = false } = {},
  ) => {
    setMessage("");
    setIsChanging(true);
    try {
      const result = await action();
      setMessage(result.message);
      if (result.success && clearUsername) setUsername("");
      await Promise.all([requests.refetch(), ...(refreshHome ? [onChanged()] : [])]);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update home access. Try again.",
      );
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <section
      id="home-invitations"
      aria-label="Home visitors"
      className="space-y-3 rounded-lg border p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Home visitors</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isChanging}
            onClick={() =>
              void change(
                () => sharing.mutateAsync({ isPublic: !isPublic, revision }),
                { refreshHome: true },
              )
            }
          >
            {isPublic ? "Make private" : "Make public"}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/home/visit/${encodeURIComponent(userId)}`}>
              Preview home visit
            </Link>
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        {isPublic
          ? "Your home is public. Any signed-in player can visit from your profile."
          : "Your home is private. Invited players can visit after accepting."}
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (username.trim() && !isChanging) {
            void change(() => invite.mutateAsync({ username: username.trim() }), {
              clearUsername: true,
            });
          }
        }}
      >
        <Input
          aria-label="Invite player by username"
          placeholder="Player username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          maxLength={191}
        />
        <Button disabled={isChanging || !username.trim()} type="submit">
          Invite
        </Button>
      </form>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {requests.isLoading && <Loader explanation="Loading home invitations" />}
      {requests.isError && (
        <div role="alert" className="flex items-center gap-2 text-sm">
          Unable to load home invitations.
          <Button
            variant="outline"
            size="sm"
            disabled={requests.isFetching || isChanging}
            onClick={() => void requests.refetch()}
          >
            Retry invitations
          </Button>
        </div>
      )}
      <UserRequestSystem
        compact
        requests={requests.data ?? []}
        userId={userId}
        isLoading={isChanging}
        onAccept={(input) => void change(() => accept.mutateAsync(input))}
        onReject={(input) => void change(() => reject.mutateAsync(input))}
        onCancel={(input) => void change(() => cancel.mutateAsync(input))}
        renderAcceptedActions={(request) =>
          request.senderId === userId ? (
            <Button
              size="sm"
              variant="outline"
              aria-label={`Revoke invitation for ${request.receiver.username}`}
              onClick={() => void change(() => cancel.mutateAsync({ id: request.id }))}
            >
              Revoke
            </Button>
          ) : (
            <Button asChild size="sm" variant="outline">
              <Link
                href={`/home/visit/${encodeURIComponent(request.senderId)}`}
                onClick={(event) => event.stopPropagation()}
              >
                View home
              </Link>
            </Button>
          )
        }
      />
    </section>
  );
};
