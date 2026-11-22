/**
 * How the table names the controls Lemu's coach steps point at. Every control a lesson
 * can ring carries `data-lesson-target` (and `data-lesson-key` where there are several
 * of it); the steps themselves come from `academyCoach` in `@/libs/kessen/academy`.
 */
import type { GuidedLessonMark } from "@/layout/tutorial/guidedLesson";
import type { AcademyTarget } from "@/libs/kessen/academy";
import { other } from "@/libs/kessen/board";
import { ROWS } from "@/libs/kessen/rules";
import type { MatchView } from "@/libs/kessen/types";

/** Selector of a lesson target. */
export const lessonTargetSelector = ({ target, key }: AcademyTarget) =>
  `[data-lesson-target="${target}"]${key === undefined ? "" : `[data-lesson-key="${key}"]`}`;

/**
 * The cards Lemu's words name, as marks for the tutorial spotlight: each unit on either
 * side of the board, card in the player's hand and leader whose name appears in `words`,
 * so "Lord Pengu's Rally" points at Lord Pengu on the table. Names are matched whole.
 */
export const lessonMarks = (
  view: MatchView,
  words: readonly (string | undefined)[],
): GuidedLessonMark[] => {
  const text = words.filter(Boolean).join("\n");
  if (!text) return [];
  const marks: GuidedLessonMark[] = [];
  const add = (cardId: string | null | undefined, selector: string) => {
    const name = cardId ? view.cards[cardId]?.name : undefined;
    if (name && namesCard(text, name)) marks.push({ selector, label: name });
  };
  const them = other(view.me);
  for (const side of [them, view.me] as const) {
    for (const row of ROWS) {
      for (const unit of view.board[side][row]) {
        add(view.inst[unit.id], lessonTargetSelector({ target: "unit", key: unit.id }));
      }
    }
  }
  for (const id of view.seats[view.me].hand ?? []) {
    add(view.inst[id], lessonTargetSelector({ target: "hand-card", key: id }));
  }
  add(view.seats[view.me].leader, lessonTargetSelector({ target: "leader" }));
  add(view.seats[them].leader, lessonTargetSelector({ target: "opponent" }));
  return marks;
};

/** The card names among `marks`, longest first, for highlighting them in Lemu's words. */
export const markedNames = (marks: readonly GuidedLessonMark[]) =>
  [...new Set(marks.map((mark) => mark.label))].sort((a, b) => b.length - a.length);

/** Whether `text` names `name` as a whole phrase (possessives included). */
const namesCard = (text: string, name: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`, "u").test(
    text,
  );

/** `value` as a literal inside a regular expression. */
export const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
