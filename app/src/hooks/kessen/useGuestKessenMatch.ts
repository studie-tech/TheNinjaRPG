"use client";

import { nanoid } from "nanoid";
import { useEffect, useRef, useState } from "react";
import type { KessenTableOutcome } from "@/layout/kessen/match/useMatchTable";
import { isAcademyLessonKey, type KessenAcademyLessonKey } from "@/libs/kessen/academy";
import type { DeckFaction } from "@/libs/kessen/deck";
import {
  concedeLocalMatch,
  type LocalKessenMatch,
  type LocalMatchRefusal,
  type LocalMatchStep,
  playLocalTurn,
  startLocalLesson,
  startLocalNpcMatch,
} from "@/libs/kessen/localMatch";
import type { KessenNpcKey } from "@/libs/kessen/npcs";
import type { KessenAction } from "@/libs/kessen/types";
import { safeLocalStorageGetItem, safeLocalStorageSetItem } from "@/utils/storage";
import { parseJsonSafe } from "@/utils/typeutils";
import type { KessenCatalogEntry, KessenMatchPayload } from "@/validators/kessen";

/**
 * A guest's seat at the war table: one match held in the browser (`libs/kessen/
 * localMatch`), started against a Circuit NPC or as an Academy lesson, with `play` and
 * `concede` shaped like the server match's so the match table renders it unchanged.
 * Nothing reaches the server. Lessons won are remembered on this device only, to mark
 * the Academy's progress for the next visit.
 */
export const useGuestKessenMatch = (
  cards: readonly KessenCatalogEntry[] | undefined,
) => {
  const [step, setStep] = useState<LocalMatchStep | null>(null);
  // The match the next decision applies to; a decision resolves before the next is sent.
  const current = useRef<LocalKessenMatch | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [lessonsWon, setLessonsWon] = useState<KessenAcademyLessonKey[]>([]);

  // Device progress is read after mount, so the prerendered hall and hydration agree.
  useEffect(() => setLessonsWon(readLessonsWon()), []);

  const open = (started: LocalMatchStep | LocalMatchRefusal) => {
    if (!started.ok) {
      setStartError(started.message);
      return false;
    }
    setStartError(null);
    current.current = started.match;
    setStep(started);
    return true;
  };

  const startNpc = (npcKey: KessenNpcKey, faction: DeckFaction) => {
    if (!cards) return refuse("The cards are still being laid out. Try again.");
    return open(
      startLocalNpcMatch({ npcKey, faction, cards, seed: nanoid(), id: guestId() }),
    );
  };

  const startLesson = (lessonKey: KessenAcademyLessonKey) => {
    if (!cards) return refuse("The cards are still being laid out. Try again.");
    return open(startLocalLesson({ lessonKey, cards, id: guestId() }));
  };

  const refuse = (message: string) => {
    setStartError(message);
    return false;
  };

  const advance = (next: LocalMatchStep) => {
    current.current = next.match;
    setStep(next);
    const lesson = next.payload.lesson;
    if (
      lesson &&
      next.payload.view.result?.winner === 0 &&
      !lessonsWon.includes(lesson)
    ) {
      const updated = [...lessonsWon, lesson];
      setLessonsWon(updated);
      safeLocalStorageSetItem(LESSONS_KEY, JSON.stringify(updated));
    }
  };

  const play = async (action: KessenAction): Promise<KessenTableOutcome> => {
    // The pending table paints before the NPC thinks.
    await nextTask();
    const match = current.current;
    if (!match) return { ok: false, message: "The match is closed." };
    const next = playLocalTurn(match, action);
    if (!next.ok) return { ok: false, payload: next.payload, message: next.message };
    advance(next);
    return { ok: true, payload: next.payload, events: next.events };
  };

  const concede = async (): Promise<KessenTableOutcome> => {
    const match = current.current;
    if (!match) return { ok: false, message: "The match is closed." };
    const next = concedeLocalMatch(match);
    advance(next);
    return { ok: true, payload: next.payload, message: "You conceded the match." };
  };

  const close = () => {
    current.current = null;
    setStep(null);
    setStartError(null);
  };

  const payload: KessenMatchPayload | null = step?.payload ?? null;
  return {
    payload,
    startError,
    lessonsWon,
    startNpc,
    startLesson,
    play,
    concede,
    close,
  };
};

const readLessonsWon = (): KessenAcademyLessonKey[] => {
  const { data } = parseJsonSafe(safeLocalStorageGetItem(LESSONS_KEY) ?? "[]");
  return Array.isArray(data) ? data.filter(isAcademyLessonKey) : [];
};

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const guestId = () => `guest-${nanoid()}`;

/** Device storage of the lessons a guest has won. */
const LESSONS_KEY = "kessen:guestAcademy";
