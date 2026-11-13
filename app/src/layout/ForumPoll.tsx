"use client";

import { useId, useState } from "react";
import { api, type RouterOutputs } from "@/app/_trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Link from "@/layout/Link";
import Loader from "@/layout/Loader";
import { showMutationToast } from "@/libs/toast";
import { useUserDataSelector } from "@/utils/UserContext";

/** Embed an existing public community poll; shared votes still require this topic's voting permission. */
export function ForumPoll({ threadId }: { threadId: string }) {
  const { data: user } = useUserDataSelector((u) => u.userId);
  const poll = api.forum.threadPoll.useQuery({ threadId }, { refetchInterval: 20000 });
  const utils = api.useUtils();
  const [error, setError] = useState("");
  const vote = api.forum.votePoll.useMutation();
  const cast = async (optionId: string | null) => {
    setError("");
    try {
      const result = await vote.mutateAsync({ threadId, optionId });
      if (!result.success) {
        setError(result.message);
        return;
      }
      await Promise.all([poll.refetch(), utils.poll.invalidate()]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your vote could not be saved. Try again.",
      );
    }
  };
  if (poll.isPending) return <Loader explanation="Loading topic poll…" />;
  if (poll.error)
    return (
      <p role="alert">
        The poll could not load.{" "}
        <Button size="sm" variant="outline" onClick={() => void poll.refetch()}>
          Try again
        </Button>
      </p>
    );
  if (!poll.data) return null;
  const data = poll.data;
  const ended = !data.isActive || (!!data.endDate && data.endDate <= new Date());
  return (
    <section
      aria-label="Topic poll"
      className="rounded-lg border bg-popover p-4 space-y-3"
    >
      <div>
        <h2 className="font-semibold text-lg">{data.title}</h2>
        <p className="text-xs text-muted-foreground">
          Public community poll · Votes are shared with the{" "}
          <Link className="underline" href="/manual/polls">
            polls page
          </Link>
          .
        </p>
      </div>
      <div className="prose prose-sm max-w-none">{data.description}</div>
      <fieldset className="space-y-2" aria-label="Poll options">
        {data.options.map((option) => (
          <div key={option.id} className="rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-sm">
                {option.text}
                {data.userOptionId === option.id && (
                  <span className="ml-2 text-xs text-primary">Your vote</span>
                )}
              </span>
              <span className="text-xs tabular-nums">
                {option.voteCount} · {option.percentage}%
              </span>
            </div>
            <div aria-hidden className="my-2 h-1.5 rounded bg-muted">
              <div
                className="h-full rounded bg-primary"
                style={{ width: `${option.percentage}%` }}
              />
            </div>
            {user && data.canVote && !ended && (
              <Button
                size="sm"
                variant={data.userOptionId === option.id ? "secondary" : "outline"}
                disabled={vote.isPending || data.userOptionId === option.id}
                onClick={() => void cast(option.id)}
              >
                {data.userOptionId === option.id ? "Selected" : "Vote"}
              </Button>
            )}
          </div>
        ))}
      </fieldset>
      <p className="text-xs text-muted-foreground">
        {data.totalVotes} {data.totalVotes === 1 ? "vote" : "votes"} ·{" "}
        {ended
          ? "Poll closed"
          : data.endDate
            ? `Closes ${data.endDate.toLocaleString()}`
            : "Voting open"}
      </p>
      {!user && <p className="text-sm">Sign in to vote.</p>}
      {user && !data.canVote && !ended && (
        <p className="text-sm">Voting is unavailable in this topic.</p>
      )}
      {data.canVote && data.userOptionId && !ended && (
        <Button
          size="sm"
          variant="ghost"
          disabled={vote.isPending}
          onClick={() => void cast(null)}
        >
          Retract my vote
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

/** Edit staff summaries and attach existing public polls without creating a separate voting system. */
export function ForumTopicExtras({
  thread,
  onDone,
}: {
  thread: NonNullable<RouterOutputs["comments"]["getForumComments"]["thread"]>;
  onDone: () => Promise<void>;
}) {
  const prefix = useId();
  const [pollId, setPollId] = useState(thread.pollId ?? "");
  const [summary, setSummary] = useState(thread.summary ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const polls = api.poll.getPolls.useInfiniteQuery(
    { limit: 25, includeInactive: true },
    { getNextPageParam: (page) => page.nextCursor },
  );
  const save = api.forum.saveTopicExtras.useMutation();
  const utils = api.useUtils();
  return (
    <form
      className="space-y-3 rounded-lg border bg-popover p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          const result = await save.mutateAsync({
            threadId: thread.id,
            pollId: pollId || null,
            summary,
            reason,
          });
          showMutationToast(result);
          if (result.success) {
            await Promise.all([
              onDone(),
              utils.forum.threadPoll.invalidate({ threadId: thread.id }),
            ]);
            setReason("");
          } else setError(result.message);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Topic extras could not be saved");
        }
      }}
    >
      <h3 className="font-semibold">Poll & topic summary</h3>
      <p className="text-xs text-muted-foreground">
        Attach an existing public poll. Its options and results remain public even in a
        private board.{" "}
        <Link href="/manual/polls" className="underline">
          Create or manage polls
        </Link>
        .
      </p>
      <label htmlFor={`${prefix}-poll`} className="block text-sm">
        Community poll
        <select
          id={`${prefix}-poll`}
          className="block w-full rounded-md border bg-background p-2"
          value={pollId}
          onChange={(e) => setPollId(e.target.value)}
        >
          <option value="">No poll</option>
          {pollId &&
            !polls.data?.pages.some((p) =>
              p.data.some((poll) => poll.id === pollId),
            ) && <option value={pollId}>Current poll</option>}
          {polls.data?.pages
            .flatMap((p) => p.data)
            .map((poll) => (
              <option key={poll.id} value={poll.id}>
                {poll.title}
                {!poll.isActive ? " (closed)" : ""}
              </option>
            ))}
        </select>
      </label>
      {polls.error && (
        <p role="alert" className="text-sm">
          Poll choices could not load.{" "}
          <Button type="button" size="sm" onClick={() => void polls.refetch()}>
            Try again
          </Button>
        </p>
      )}
      {polls.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={polls.isFetchingNextPage}
          onClick={() => void polls.fetchNextPage()}
        >
          More polls
        </Button>
      )}
      <label htmlFor={`${prefix}-summary`} className="block text-sm">
        Staff summary
        <Textarea
          id={`${prefix}-summary`}
          maxLength={2000}
          rows={5}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Give returning readers a concise, factual overview of the discussion."
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Write in plain text. Keep the summary accurate as the discussion changes; clear
        it to remove it.
      </p>
      <label htmlFor={`${prefix}-reason`} className="block text-sm">
        Reason
        <Input
          id={`${prefix}-reason`}
          required
          minLength={3}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button disabled={save.isPending || reason.trim().length < 3}>
        Save poll & summary
      </Button>
    </form>
  );
}
