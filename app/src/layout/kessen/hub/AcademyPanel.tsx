"use client";

import { Check, ChevronDown, GraduationCap, Lock, Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { FeedbackAlert } from "@/layout/FeedbackAlert";
import Image from "@/layout/Image";
import type {
  KessenAcademyLessonKey,
  KessenAcademyProgress,
} from "@/libs/kessen/academy";
import { kessenPackName } from "@/libs/kessen/packs";
import { cn } from "@/libs/shadui";
import { kessenPackArt } from "../kessenArt";

/**
 * Lemu's Academy in the Card Hall: progress through the six lessons, the recommended
 * next one with its idea and a start button, and the whole series on request: each
 * lesson's idea, a tick once completed, Replay for completed ones and the reason a later
 * one is still closed. The graduation pack shows until it is earned, then as earned.
 */
export const AcademyPanel = ({
  academy,
  pending,
  startingKey,
  error,
  onStart,
}: {
  academy: KessenAcademyProgress;
  /** A lesson start is in flight; the buttons wait. */
  pending: boolean;
  /** The lesson being started, whose button shows the progress. */
  startingKey: KessenAcademyLessonKey | null;
  /** Why the last lesson start failed, shown under the panel's buttons. */
  error: string | null;
  onStart: (lessonKey: KessenAcademyLessonKey) => void;
}) => {
  const next = academy.lessons.find((lesson) => lesson.key === academy.next) ?? null;
  // A player with lessons left sees the next one; a graduate sees the list folded.
  const [listOpen, setListOpen] = useState(false);
  const packName = kessenPackName(academy.graduationPackId) ?? "a card pack";
  return (
    <section
      className="kh-panel flex flex-col gap-3 p-3"
      aria-labelledby="kessen-academy-title"
      data-academy=""
    >
      <div className="flex items-start gap-3">
        <GraduationCap className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2
            id="kessen-academy-title"
            className="kh-heading text-[20px] leading-tight"
          >
            Lemu's Academy
          </h2>
          <p className="text-muted-foreground text-[13px]">
            Six short lessons, one strategic idea each.
          </p>
        </div>
        <Badge
          variant={academy.graduated ? "default" : "secondary"}
          className="shrink-0 text-[12px] tabular-nums"
        >
          {academy.completed}/{academy.total}
        </Badge>
      </div>
      <Progress
        value={(academy.completed / academy.total) * 100}
        className="h-2"
        aria-label={`Academy progress: ${academy.completed} of ${academy.total} lessons`}
      />
      {next ? (
        <div className="flex flex-col gap-2 kh-callout p-3">
          <p className="m-0">
            <span className="block font-semibold text-[12px] uppercase tracking-wider text-muted-foreground">
              Next · Lesson {next.order}
            </span>
            <span className="block font-bold text-base">{next.title}</span>
            <span className="block text-[13px]">{next.summary}</span>
          </p>
          <Button
            className="self-start"
            loading={pending && startingKey === next.key}
            disabled={pending}
            onClick={() => onStart(next.key)}
          >
            <Play className="mr-2 h-4 w-4" aria-hidden />
            Start lesson {next.order}
          </Button>
        </div>
      ) : null}
      <p className="m-0 flex items-center gap-2 text-[13px]">
        <Image
          src={kessenPackArt(academy.graduationPackId)}
          alt=""
          width={48}
          height={72}
          className="h-[36px] w-auto shrink-0"
        />
        <span>
          {academy.graduated ? (
            <>
              Graduated: <strong>{packName}</strong> earned.
            </>
          ) : (
            <>
              Each first completion pays ryo; finishing all six adds{" "}
              <strong>{packName}</strong>.
            </>
          )}
        </span>
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="self-start h-9 text-[13px] pointer-coarse:min-h-11"
        aria-expanded={listOpen}
        aria-controls="kessen-academy-lessons"
        onClick={() => setListOpen(!listOpen)}
      >
        <ChevronDown
          className={cn("mr-1 h-4 w-4 transition-transform", listOpen && "rotate-180")}
          aria-hidden
        />
        {listOpen ? "Hide the lessons" : "All lessons"}
      </Button>
      {listOpen ? (
        <ol id="kessen-academy-lessons" className="flex flex-col gap-2">
          {academy.lessons.map((lesson) => (
            <li
              key={lesson.key}
              className={cn(
                "flex items-start gap-2 rounded-md border p-2",
                lesson.key === academy.next && "kh-callout",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-bold text-[12px]",
                  lesson.completed && "border-success bg-success text-background",
                )}
                aria-hidden
              >
                {lesson.completed ? (
                  <Check className="h-3.5 w-3.5" />
                ) : lesson.lockReason ? (
                  <Lock className="h-3 w-3" />
                ) : (
                  lesson.order
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="m-0 font-semibold">
                  {lesson.order}. {lesson.title}
                  {lesson.completed ? (
                    <span className="sr-only"> (completed)</span>
                  ) : null}
                </p>
                <p className="m-0 text-[13px]">{lesson.idea}</p>
                {lesson.lockReason ? (
                  <p className="m-0 text-muted-foreground text-[12px]">
                    {lesson.lockReason}
                  </p>
                ) : lesson.completed ? null : (
                  <p className="m-0 text-muted-foreground text-[12px]">
                    First completion: {lesson.rewardRyo.toLocaleString()} ryo
                  </p>
                )}
              </div>
              {lesson.lockReason ? null : (
                <Button
                  variant={lesson.completed ? "outline" : "default"}
                  size="sm"
                  className="shrink-0 h-9 text-[13px] pointer-coarse:min-h-11"
                  loading={pending && startingKey === lesson.key}
                  disabled={pending}
                  onClick={() => onStart(lesson.key)}
                  aria-label={`${lesson.completed ? "Replay" : "Start"} lesson ${lesson.order}, ${lesson.title}`}
                >
                  {lesson.completed ? (
                    <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden />
                  ) : (
                    <Play className="mr-1 h-3.5 w-3.5" aria-hidden />
                  )}
                  {lesson.completed ? "Replay" : "Start"}
                </Button>
              )}
            </li>
          ))}
        </ol>
      ) : null}
      {error ? (
        <FeedbackAlert feedback={{ success: false, message: error }} foreground />
      ) : null}
    </section>
  );
};
