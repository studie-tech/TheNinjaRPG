import { afterEach, expect, it } from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { LessonNotice, LessonSpotlight } from "@/layout/kessen/match/LessonSpotlight";
import { guidedLessonAtom } from "@/layout/tutorial/guidedLesson";
import type { AcademyCoachStep } from "@/libs/kessen/academy";

const heading = { order: 2, total: 6, title: "Enough Is Enough" };
const coach: AcademyCoachStep = {
  target: "hand-card",
  key: "s0-3",
  tone: "guide",
  title: "Just enough",
  text: "Tap Arashima, your smallest card, and play it.",
  why: "Winning a round by 1 is as good as by 30.",
  retry: false,
  action: null,
};
const lesson = () => getDefaultStore().get(guidedLessonAtom);

/** A lesson table: the coach mounts inside it, and it is in play while it shows Pass. */
const Table = ({
  coach: step,
  pass = true,
}: {
  coach?: "spot" | "notice";
  pass?: boolean;
}) => (
  <main aria-label="Kessen table">
    {pass ? (
      <button type="button" data-lesson-target="pass">
        Pass
      </button>
    ) : null}
    {step === "spot" ? <LessonSpotlight step={coach} lesson={heading} /> : null}
    {step === "notice" ? (
      <LessonNotice lesson={heading} title="Pass now?" tone="mistake" lead="Not yet.">
        <button type="button">Keep playing</button>
      </LessonNotice>
    ) : null}
  </main>
);

afterEach(() => {
  cleanup();
  getDefaultStore().set(guidedLessonAtom, null);
});

it("registers the coach step with the tutorial assistant under the lesson heading", () => {
  render(<Table coach="spot" />);
  expect(lesson()?.id).toBe("kessen-academy-2");
  expect(lesson()?.step).toMatchObject({
    eyebrow: "Lesson 2 of 6 · Enough Is Enough",
    title: "Just enough",
    action: "Tap Arashima, your smallest card, and play it.",
    target: '[data-lesson-target="hand-card"][data-lesson-key="s0-3"]',
  });
  expect(lesson()?.step.progress).toEqual({ position: 2, total: 6 });
  expect(lesson()?.step.blocking).toBeUndefined();
});

it("hands over between coach components without a gap and asks for answers", async () => {
  const view = render(<Table coach="spot" />);
  view.rerender(<Table coach="notice" />);
  expect(lesson()?.step.title).toBe("Pass now?");
  expect(lesson()?.step.blocking).toBe(true);
  await act(async () => {});
  // The release scheduled by the unmounted spotlight was cancelled by the notice.
  expect(lesson()?.step.title).toBe("Pass now?");
});

it("keeps the lesson while the table plays out and clears it when the table ends", async () => {
  const view = render(<Table coach="spot" />);
  view.rerender(<Table />);
  await act(async () => {});
  expect(lesson()?.id).toBe("kessen-academy-2");
  expect(lesson()?.step.title).toBe("Watch the table");
  // The next turn's coach takes over again.
  view.rerender(<Table coach="spot" />);
  expect(lesson()?.step.title).toBe("Just enough");
  view.rerender(<Table />);
  await act(async () => {});
  expect(lesson()?.step.title).toBe("Watch the table");
  // The result shows: no Pass control is left.
  view.rerender(<Table pass={false} />);
  await waitFor(() => expect(lesson()).toBeNull());
});

it("clears at once when the table closes with the coach on screen", async () => {
  const view = render(<Table coach="spot" />);
  view.unmount();
  await waitFor(() => expect(lesson()).toBeNull());
});
